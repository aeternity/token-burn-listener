// Anleitung zum Filtern von Events nach indexed parametern: https://media.consensys.net/technical-introduction-to-events-and-logs-in-ethereum-a074d65dd61e
const Web3 = require("web3")
const axios = require('axios')
const tokenBurnerABI = require("./tokenBurner_abi_without_checks.json")
const schedule = require("node-schedule");

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

let loginRequestHeaders = {
  "Content-Type": "application/json",
};

let user_token;

axios.post(
  `${BL_URL}/users/login`,
  { login : LOGIN, password : PASSWORD},
  { headers: loginRequestHeaders})
  .then(function(response) {
    user_token = response.data["user-token"];
    console.log("LOGGED IN. User token: " + user_token);
}).catch((err) => {
  console.log("LOGIN FAILED!");
  console.log(err);
});

web3 = new Web3(new Web3.providers.WebsocketProvider(WEB3_URL))
const TokenBurner = new web3.eth.Contract(tokenBurnerABI, BURNER_CONTRACT)

TokenBurner.events.Burn({fromBlock: "latest" })
  .on('data', function(event){
    console.log(event)
    let txID = event.transactionHash
    let returns = event.returnValues
    let value = returns['_value']
    let pubkey = web3.utils.toUtf8(returns['_pubkey'])

    axios.post(
      `${BL_URL }/data/TokenBurnings`, {
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
        } else if (response.status == 400) {
          console.log("FAILURE! Check parameters. It should not happen in production")
        } else {
          console.log(response)
        }
      }).catch((error) => console.log(error))
  })
  .on('error', function(error) {
    console.log(error)
  })


// Check every 10 min if the table size is equal to the burnCount
schedule.scheduleJob("* */10 * * * *", async () => {
  console.log("----- SCHEDULER: start!")

  let currentBlock = await web3.eth.getBlockNumber();
  console.log("----- SCHEDULER: Current block " + currentBlock)

  TokenBurner.methods.burnCount().call(async function(error, result){
    let burnCount = result;
    console.log("----- SCHEDULER: Current burn count " + burnCount);
    let response = await axios.get(
      `${BL_URL}/data/TokenBurnings?props=Count(objectId)`,
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
        fromBlock: currentBlock - 1000, 
        toBlock: currentBlock,
      },
      async (errors, events) => {
        if (errors) {
          console.log("----- SCHEDULER: ERROR! " + errors);
          return;
        }
        if (events.length <= 0){
          console.log("----- SCHEDULER: No events found, although the entry count and the burn count are not equal!"
          + "\nPlease decrease the fromBlock manually or check if the database is ok.");
        }
        let returns;

        for (let i=0; i<events.length; i++) {
          returns = events[i].returnValues;
          response = await axios.get(
            `${BL_URL}/data/TokenBurnings?where=count%3D${returns._count}`,
            {"user-token" : user_token}
          );
      
          if (response.data.length != 0) continue;
          console.log("----- SCHEDULER: Found a missing entry with transactionHash "+ events[i].transactionHash +". Writing into the database ... ");
          axios.post(
            `${BL_URL}/data/TokenBurnings`, {
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
            } else if (response.status == 400) {
              console.log("----- SCHEDULER: FAILURE! Data not saved! Check parameters. It should not happen in production")
            } else {
              console.log("----- SCHEDULER: OOOOOPS " + response)
            }
          }).catch((error) => console.log("----- SCHEDULER: ERROR! " + error))
        }
      }
    )
  })
})

