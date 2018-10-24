// Anleitung zum Filtern von Events nach indexed parametern: https://media.consensys.net/technical-introduction-to-events-and-logs-in-ethereum-a074d65dd61e
const Web3 = require("web3")
const axios = require('axios')
const tokenBurnerABI = require("./tokenBurner_abi_without_checks.json")

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').load()
}

const BL_ID = process.env.NODE_BL_ID
const BL_KEY = process.env.NODE_BL_KEY
const BURNER_CONTRACT = process.env.NODE_BURNER_CONTRACT
const WEB3_URL = process.env.NODE_WEB3_URL
const BL_URL = `https://api.backendless.com/${BL_ID}/${BL_KEY}`

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
      }).then(function(response){
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



