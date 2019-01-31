// Anleitung zum Filtern von Events nach indexed parametern: https://media.consensys.net/technical-introduction-to-events-and-logs-in-ethereum-a074d65dd61e
const Web3 = require("web3")
const axios = require('axios')
const tokenBurnerABI = require("./tokenBurner_abi_without_checks.json")
const schedule = require("node-schedule");
const Sentry = require('@sentry/node');
var redis = require("redis");
const REDIS_URL = process.env.REDIS_URL;
var client = redis.createClient(REDIS_URL);
const { promisify } = require('util');
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const fs = require('fs');


if (process.env.NODE_ENV !== 'production') {
  require('dotenv').load()
}

const BL_ID = process.env.NODE_BL_ID
const BL_KEY = process.env.NODE_BL_KEY
const BURNER_CONTRACT = process.env.NODE_BURNER_CONTRACT
const WEB3_URL = process.env.NODE_WEB3_URL
const BL_URL = `https://api.backendless.com/${BL_ID}/${BL_KEY}`
const LOGIN = process.env.NODE_BL_LOGIN;
const PASSWORD = process.env.NODE_BL_PASSWORD;
const TABLE = process.env.NODE_BL_TABLE;
const SENTRY_URL = process.env.NODE_SENTRY_URL;

Sentry.init({ dsn:SENTRY_URL });


let loginRequestHeaders = {
  "Content-Type": "application/json",
};

var user_token;

// fetch a backendless login token from redis

getAsync('usertoken').then(async function(res) {
  console.log("Return from redis: " + res);

  // if there was none set, get a new backendless token from backendless
  if (res == null) {
    // get user token from backendless
    axios.post(
      `${BL_URL}/users/login`,
      { login : LOGIN, password : PASSWORD},
      { headers: loginRequestHeaders})
      .then(async function(response) {
        user_token = response.data["user-token"];
        console.log("LOGGED IN. User token: " + user_token);

        // post backendless login token to redis for other script instances to use (...kubernetes...)
        let redisResult = await setAsync('usertoken', user_token);
        console.log(redisResult);

    }).catch((err) => {
      console.log("LOGIN to backendless FAILED!");
      console.log(err);
      Sentry.captureMessage(err);
      throw err;
    });
  } else {
    user_token = res;
  }
});




const provider = new Web3.providers.WebsocketProvider(WEB3_URL)
const web3 = new Web3(provider)
provider.on('error', error => {
  console.log('WS Error');
  console.log(error);
  Sentry.captureMessage('WS Error');
  throw error;
  process.exit(1);
});
provider.on('end', error => {
  console.log('WS closed');
  console.log(error);
  Sentry.captureMessage('WS closed');
  throw error;
  process.exit(1);
});

const TokenBurner = new web3.eth.Contract(tokenBurnerABI, BURNER_CONTRACT)

TokenBurner.events.Burn({fromBlock: "latest" })
  .on('data', function(event){
    let txID = event.transactionHash
    let returns = event.returnValues
    let value = returns['_value']
    let pubkey = web3.utils.toUtf8(returns['_pubkey'])

    console.log("Burn event:", parseInt(returns['_count']), value, txID)

    axios.post(
      `${BL_URL }/data/${TABLE}`, {
        "count" : parseInt(returns['_count']),
        "deliveryPeriod" : parseInt(returns['_deliveryPeriod']),
        "from" : returns['_from'],
        "pubKey" : pubkey,
        "value" : value,
        "transactionHash" : txID
      },
      { headers: {"user-token" : user_token}})
      .then(function(response){
        if (response.status == 200) {
          console.log("Data saved with ID " + response.data['objectId'])
        } else {
          console.log(response)
          Sentry.captureMessage(response.status, response.statusText, response.data.message);
        }
      }).catch((error) => {
        // 1155 is `duplicateValue`, that is normal because of redundancy
        if(error.response.data.code == 1155) {
          console.log("Event was already present in table")
        } else {
          Sentry.captureException(error);
          console.log(error)
        }
      })
  })
  .on('error', function(error) {
    Sentry.captureException(error);
    throw error;
    process.exit(1);
  })


// Check every 3 min if the table size is equal to the burnCount
var rescan = async () => {
  console.log("----- SCHEDULER: start!")

  let currentBlock = await web3.eth.getBlockNumber();
  console.log("----- SCHEDULER: Current block " + currentBlock)

  TokenBurner.methods.burnCount().call(async function(error, result){
    if (error) {
      console.log("----- SCHEDULER: ERROR! " + error);
      Sentry.captureException(error);
      throw error;
    }
    let burnCount = result;
    console.log("----- SCHEDULER: Current burn count " + burnCount);
    let response = await axios.get(
      `${BL_URL}/data/${TABLE}?props=Count(objectId)`,
      {"user-token" : user_token}
    );
    let entryCount = response.data[0].count;
    console.log("----- SCHEDULER: Current entry count " + entryCount);

    if (burnCount <= entryCount) {
      console.log("----- SCHEDULER: OK.");
      return;
    }

    await TokenBurner.getPastEvents(
      "Burn",
      {
        fromBlock: currentBlock - 500,
        //fromBlock: 7078580,
        toBlock: currentBlock,
      },
      async (errors, events) => {
        if (errors) {
          console.log("----- SCHEDULER: ERROR! " + errors);
          //throw errors;
          fs.writeFileSync("./error.txt", errors);
        }
        if (events.length <= 0){
          console.log("----- SCHEDULER: No events found, although the entry count and the burn count are not equal!"
          + "\nPlease decrease the fromBlock manually or check if the database is ok.");
        }
        let returns;

        for (let i=0; i<events.length; i++) {
          returns = events[i].returnValues;
          response = await axios.get(
            `${BL_URL}/data/${TABLE}?where=count%3D${returns._count}`,
            {"user-token" : user_token}
          );

          if (response.data.length != 0) continue;
          console.log("----- SCHEDULER: Found a missing entry with transactionHash "+ events[i].transactionHash +". Writing into the database ... ");
          axios.post(
            `${BL_URL}/data/${TABLE}`, {
            "count" : parseInt(returns['_count']),
            "deliveryPeriod" : parseInt(returns['_deliveryPeriod']),
            "from" : returns['_from'],
            "pubKey" : web3.utils.toUtf8(returns['_pubkey']),
            "value" : returns['_value'],
            "transactionHash" : events[i].transactionHash
          },
          { headers: {"user-token" : user_token}})
          .then(function(response){
            if (response.status == 200) {
              console.log("----- SCHEDULER: Data saved with ID " + response.data['objectId'])
            } else {
              console.log("----- SCHEDULER: OOOOOPS " + response)
              Sentry.captureMessage("----- SCHEDULER: OOOOOPS " + response);
            }
          }).catch((error) => {
            console.log("Backendless error:")
              console.log(error);
            // 1155 is `duplicateValue`, that is normal because of redundancy
            if(error.response.data.code == 1155) {
              console.log("Event was already present in table")
            } else {
              Sentry.captureException(error);
              console.log(error)
            }
          })
        }
      }
    )
  })
}
setInterval(() => {
  rescan();
}, 180000);

