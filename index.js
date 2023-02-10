import got from 'got'
import open from 'open'
import promptSync from 'prompt-sync'
import { stringify } from 'csv-stringify/sync'
import fs from 'fs'
import path from 'path'

const oidcBase = 'https://stigman.nren.navy.mil/auth/realms/np-stigman'
const apiBase = 'https://stigman.nren.navy.mil/np/api'
const client_id = 'np-stig-manager'
//const scope = 'openid stig-manager:collection'
const scope = 'openid stig-manager:collection stig-manager:user stig-manager:stig stig-manager:op'


run()


async function run() {
  try {
    const oidcMeta = await getOidcMetadata(oidcBase)
    if (!oidcMeta.device_authorization_endpoint) {
      console.log(`Device Authorization grant is not supported by the OIDC Provider`)
      process.exit(1);
    }
    const response = await getDeviceCode(oidcMeta.device_authorization_endpoint, client_id, scope)

    //console.log(response)

    //await new Promise(resolve => setTimeout(resolve, 5000));
    //console.log(process.argv)

    //open(process.argv[2] === 'complete' ? response.verification_uri_complete : response.verification_uri)
    open(response.verification_uri_complete)


    let fetchToken = () => getToken(response.device_code)

    let validate = result => !!result.access_token
    let tokens = await poll(fetchToken, validate, response.interval * 1000)
    console.log(`Got access token from Keycloak`)

    console.log(`Requesting STIG Manager Collections`)
    const collections = await getCollections(tokens.access_token)
    //console.log(collections)

    var stigs = []
    var assets = []
    var rows = []

    for (var i = 0; i < collections.length; i++) {
      var collectionName = collections[i].name;

      //console.log("Requesting STIGS")
      stigs = await getStigs(tokens.access_token, collections[i].collectionId)
      //console.log(stigs)

      //console.log("Requesting assets")
      for (var k = 0; k < stigs.length; k++) {
        assets.length = 0;
        assets = await getAssets(tokens.access_token, collections[i].collectionId, stigs[k].benchmarkId)
        //console.log(assets)

        var myData = getRow(collectionName, stigs[k], assets)
        //console.log('myData: ', myData)
        //console.log('myData.length: ' + myData.length)
        //console.log(stringify(myData))

        rows.push(myData)
      }
    }

    const output = stringify(rows, {
      header: true
    })
    //console.log(output)

    const prompt = promptSync()
    const filePath = prompt('Where do you want to save the file? Enter full path name.')
    console.log(filePath)

    fs.writeFile(filePath, output, function (err) {
      if (err) {
        return console.log(err);
      }
      console.log("The file was saved!");
    });

  }
  catch (e) {
    console.log(e)
  }
}

function wait(ms = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function poll(fn, fnCondition, ms) {
  let result = await fn()
  while (!fnCondition(result)) {
    await wait(ms)
    result = await fn()
  }
  return result
}

async function getToken(device_code) {
  try {
    console.log('Requesting token')
    const response = await got.post('https://stigman.nren.navy.mil/auth/realms/np-stigman/protocol/openid-connect/token', {
      //const response = await got.post('https://stigman.nren.navy.mil/auth/realms/np-stigman/protocol/openid-connect/token',{
      //const response = await got.post('http://localhost:8080/realms/stigman/protocol/openid-connect/token', {
      //const response = await got.post('https://login.microsoftonline.com/863af28d-88be-4b4d-a58a-d5c40ee1fa22/oauth2/v2.0/token', {
      form: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'np-stig-manager',
        device_code
      }
    }).json()
    return response
  }
  catch (e) {
    console.log(e)
    return {}
  }
}

async function getDeviceCode(url, client_id, scope) {
  return await got.post(url, {
    form: {
      client_id,
      scope
    }
  }).json()
}

async function getOidcMetadata(url) {
  return await got.get(`${url}/.well-known/openid-configuration`).json()
}

async function getCollections(accessToken) {
  var myUrl = apiBase + '/collections'
  var collections = getMetricsData(accessToken, myUrl)
  return collections
}

async function getStigs(accessToken, collectionId) {
  //console.log('inGetStigs')
  var myUrl = apiBase + '/collections/' + collectionId + '/stigs'
  var metrics = getMetricsData(accessToken, myUrl)
  return metrics
}

async function getAssets(accessToken, collectionId, benchmarkId) {
  //console.log('inGetStigs')
  var myUrl = apiBase + '/collections/' + collectionId + '/stigs/' + benchmarkId + '/assets'
  var assets = getMetricsData(accessToken, myUrl)
  return assets
}

async function getMetricsData(accessToken, myUrl) {
  //console.log("getMetricsData: Requesting data.")
  return await got.get(myUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  }).json()
}

function getRow(collectionName, stigs, assets) {
  var assetNames = ''
  var benchmarkId = stigs.benchmarkId
  var stigVersion = stigs.lastRevisionStr

  for (var i = 0; i < assets.length; i++) {
    if (i < assets.length - 1) {
      assetNames += assets[i].name + ', '
    }
    else {
      assetNames += assets[i].name
    }
  }

  var rowData = {
    collectionName: collectionName,
    benchmark: benchmarkId,
    stigVersion: stigVersion,
    assetNames: assetNames
  }

  return rowData
}