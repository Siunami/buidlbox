/* ------------------------ Node.js Dependencies ------------------------ */
const URL = require('url-parse');

/* ------------------------ External Dependencies ------------------------ */
const functions = require('firebase-functions') // We can use `import` sytax. Why? idn... @kamescg
const admin = require('firebase-admin') // We can use `import` sytax. Why? idn... @kamescg
const ethers = require('ethers');

const uuid = require('uuid/v1');
const express =  require('express');
const uport = require('uport');
const Credentials = uport.Credentials;
const SimpleSigner = uport.SimpleSigner;
// // import { Credentials, SimpleSigner } from 'uport'
const serviceAccount = require('../secrets/service_account.json')
/* ------------------------- Internal Dependencies -------------------------- */
const cors = require('cors');
const db = require('./database');

// Constants
cors({origin: true});
const databaseURL = "https://buidlbox-dev.firebaseio.com"

/**
 * uPort | Simple Signer
 * 
 * The SimpleSigner key is reponsible for verifying decentralized applications.
 * In producion please add the SimpleSigner key as an envrionment variable.
 * 
 * Example: firebase functions:config:set uport.simpleSigner='INSERT_KEY'  
 */
// const uportSimpleSigner = functions.config().uport.simplesigner;
const uportSimpleSigner = SimpleSigner('d12d8a5c643ab7facc0a1815807aba1bed174762a2061b6b098b7bffd7462236')

/* ------------------------ Initialize Dependencies ------------------------- */
/**
 * Firebase - Administrator Initialization
 */
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL
});
const firestore = admin.firestore();
const database = admin.database();
/* -------------------------------------------------------------------------- */

/* ------------------------ Firebase Cloud Functions ------------------------ */

/* -------------------------------------------------------------------------- */

/*---*---------------              ---------------*---* 

                  Identity Authentication

/*---*---------------              ---------------*---*/
exports.identity = functions.https.onRequest((request,response)=> {
  cors(request, response, () => {
    admin.auth().createCustomToken(request.body.data)
    .then(function(customToken) {
      response.json(customToken).send()
    })
    .catch(function(error) {
      response.send(error)
      console.log("Error creating custom token:", error);
    });
  })  
})

/*---*---------------              ---------------*---* 

                    Database Requests 

/*---*---------------              ---------------*---*/
exports.attestationRequest = functions.database.ref('/request/attestation/{request}')
  .onCreate(event => {
    const eventKey = event.data.key 
    const eventData = event.data.val()
    if(eventData.meta.status) {
      switch(eventData.meta.status) {

        /**
         * Manage Attestation Requests
         * 
         * TODO(@kamescg): Better Attestation Verification database naming structure.
         * 
         * Currently the '/request/attestation/' path is montired for database changes.
         * This is just a starting point and MVP for data streaming between frontend/backend
         *  
         * The process needs to be more thoroughly thought about to fully understand how we
         * can enable as many verifiatons systems to "hook" into our private verification attestation
         * framework/boilerplate. 
         */

        case('initialized'):
              db.databaseSearch({
                branch: ["users"],
                boundaries: {
                  equalTo: eventData.meta.uid
                },
                order: {
                  orderByChild: "questKey" // QuestKey is a param specific to a @kamescg project. This needs to be changed for all projects.
                }
              }).then(lookup=>{
                var credentials = new Credentials({
                  appName: 'Eidenai',
                  address: '2oo7fQjxR44MnKa8n4XKDZBBa2Buty4qrug',
                  signer: uportSimpleSigner,
                  networks: {'0x4': {'registry' : '0x2cc31912b2b0f3075a87b3640923d45a26cef3ee', 'rpcUrl' : 'https://rinkeby.infura.io'}}
                }).attest({
                  sub: lookup[0].address,
                  claim: {
                    ...eventData.data
                  }
                }).then(attestation=>{
                    db.databaseWrite({
                      config: {writeType: 'update'},
                      entity: 'users',
                      branch: ["request", 'attestation', eventKey],
                      payload: {
                        ...eventData,
                        admin: {
                          attestation: `me.uport:add?attestations=${attestation}`, // TODO(@kamescg) Update this JWT generation using Zach's new libraries.
                          issued: true
                        }
                      },
                    })

                }).catch(err=>console.log(err))
            })
          break;
          default:
          // TODO(@kamescg): Handle default use case. 
          break;
      }
    }
  })

/*---*---------------              ---------------*---* 

                      Authentication 

/*---*---------------              ---------------*---*/
exports.authenticationComplete = functions.auth.user().onCreate(event => {

  const providerAccountType = {
    "google.com": 'google',
    "github.com": 'github',
    "twitter.com": 'twitter',
    "facebook.com": 'facebook',
  }[event.data.providerData.providerId]

  const person = {
    eid: event.data.uid,
    images: {
      imageProfile: event.data.photoURL
    },
    name: {
      nameDisplay: event.data.displayName,
      nameFirst: event.data.displayName,
    },
    contact: {
      contactEmail: event.data.email,
    },
    metadata: {
      metadataAccountType: providerAccountType || false
    },
    provider: event.data.providerData,
  }
  firestore.collection('people').add(person)

});

/*---*---------------              ---------------*---* 

                    Ethereum Send Token

/*---*---------------              ---------------*---*/
/* TODO (@siunami): Currently everything is hardcoded

@param {string} infuraProviderKey         Get an access key at infura.io
@param {string} privateKeyOfSender        privateKey of signer
@param {string} sendTokenTo               address to send token to
@param {int} sentToken                    num tokens to send
@param {array} myContractABI
@param {string} myContractAddress

Example Query:
https://us-central1-buidlbox-dev.cloudfunctions.net/sendToken?sendAddress=0x212107C7a1dA9a2a72cb8F7dce3ac3d05678DD89&numTokens=1

*/
exports.sendToken = functions.https.onRequest((req,res) => {
  var infuraProviderKey = '';
  var privateKeyOfSender = '';
  var sendTokenTo = req.query.sendAddress;
  var numTokensToSend = req.query.numTokens;

  var myContractABI = [];
  var myContractAddress = "";

  var provider = new ethers.providers.InfuraProvider('rinkeby',infuraProviderKey);
  var wallet = new ethers.Wallet(privateKeyOfSender, provider);
  var contract = new ethers.Contract(myContractAddress, myContractABI, wallet);

  var sentToken = contract.transfer(sendTokenTo, numTokensToSend*100);
  sentToken.then(function(){
    console.log("SUCCESS");
    res.header("Access-Control-Allow-Origin", "*");
    res.send({"status":"success"});
    return {"status":"success"}
    // return res.redirect(303, {"success":"success"});
  }).catch(function(err){
    console.log("FAILURE");
    console.log(err);
    res.header("Access-Control-Allow-Origin", "*");
    res.send({"status":"error"});
    return {"status":"error"}
    // return res.redirect(404, err);
  })
})


/*---*---------------              ---------------*---* 

                    Query users 

/*---*---------------              ---------------*---*/
/*
@function
Checks if a user is registered in firebase

@param {string} userAddress             Address to query

@return {boolean}
*/
exports.queryUsers = functions.https.onRequest((req,res) => {
  var userAddress = req.query.userAddress;
  admin.database().ref('users').orderByChild('publicKey').equalTo(userAddress).on('value', function(snapshot){
      var isRegistered = false;
      for (var key in snapshot.val()){
        console.log(snapshot.val()[key].name);
        console.log(snapshot.val()[key].publicKey);
        if (snapshot.val()[key].publicKey == userAddress){
          isRegistered = true;
        }
      }
      res.header("Access-Control-Allow-Origin", "*");
      res.send(isRegistered);
      return true;
  }, function(err){
    res.header("Access-Control-Allow-Origin", "*");
    res.send(false);
    return false;
  });
})


/*---*---------------              ---------------*---* 

                    Check User Balance 

/*---*---------------              ---------------*---*/
/* 
@function:
Checks if a user has tokens for a specific ERC20 contract

@param {string} userAddress               Address to check token balance
@param {string} infuraProviderKey         Get an access key at infura.io
@param {array} myContractABI
@param {string} myContractAddress

@return {boolean}

Example Query:
https://us-central1-buidlbox-dev.cloudfunctions.net/checkUserBalance?userAddress=0x3d36252840042D0B84Adc99a8c7ECF1F10a19E6a

*/
exports.checkUserBalance = functions.https.onRequest((req,res) => {
  var userAddress = req.query.userAddress;

  var infuraProviderKey = '';
  var myContractABI = [];
  var myContractAddress = "";

  var provider = new ethers.providers.InfuraProvider('rinkeby',infuraProviderKey);
  var contract = new ethers.Contract(myContractAddress, myContractABI, provider);

  contract.balanceOf(userAddress).then(function(value){
    console.log("Address " + userAddress + " has " + value + " tokens.")
    if (value >= 100){
      res.header("Access-Control-Allow-Origin", "*");
      res.send(true);
      return true;
    } else {
      res.header("Access-Control-Allow-Origin", "*");
      res.send(false);
      return false
    }
  })
})
