var logOnDetails = {
  account_name: '',
  password: ''
};

try {
  var sha1 = require('crypto').createHash('sha1');
  sha1.end();
  logOnDetails.sha_sentryfile = require('fs').readFileSync('sentry');
} catch (e) {}

// logOnDetails.auth_code = ''; // code received by email

var admin = ''; // put your steamid here to say 'give' to the bot and receive all non-scrap items


var getInterface = require('steam-web-api');
var Steam = require('steam');
var SteamCrypto = require('steam-crypto');
var SteamTrade = require('./'); // change to 'steam-trade' if not running from the same directory

var webLoginKey;

var steamClient = new Steam.SteamClient();
var steamUser = new Steam.SteamUser(steamClient);
var steamFriends = new Steam.SteamFriends(steamClient);
var steamTrading = new Steam.SteamTrading(steamClient);
var steamTrade = new SteamTrade();

function webAuth(callback) {
  var sessionKey = SteamCrypto.generateSessionKey();
  
  getInterface('ISteamUserAuth').post('AuthenticateUser', 1, {
    steamid: steamClient.steamID,
    sessionkey: sessionKey.encrypted,
    encrypted_loginkey: SteamCrypto.symmetricEncrypt(new Buffer(webLoginKey), sessionKey.plain)
  }, function(statusCode, body) {
    if (statusCode != 200) {
      // request a new login key first
      steamUser.requestWebAPIAuthenticateUserNonce(function(nonce) {
        webLoginKey = nonce.webapi_authenticate_user_nonce;
        webAuth(callback);
      });
      return;
    }
    var sessionID = Math.floor(Math.random() * 1000000000).toString();
    steamTrade.sessionID = sessionID;
    var cookies = [
      'sessionid=' + sessionID,
      'steamLogin=' + body.authenticateuser.token,
      'steamLoginSecure=' + body.authenticateuser.tokensecure
    ];
    console.log('got a new cookie:', cookies);
    cookies.forEach(function(cookie) {
        steamTrade.setCookie(cookie);
    });
    callback && callback();
  });
}

steamClient.connect();
steamClient.on('connected', function() {
  steamUser.logOn(logOnDetails);
});

steamClient.on('logOnResponse', function(logonResp) {
  if (logonResp.eresult == Steam.EResult.OK) {
    webLoginKey = logonResp.webapi_authenticate_user_nonce;
    console.log('Logged in!');
    steamFriends.setPersonaState(Steam.EPersonaState.Online);
    webAuth();
  } else {
    console.log('Logon fail: ' + logonResp.eresult);
  }
});

var inventory;
var scrap;
var weapons;
var addedScrap;
var client;

steamTrading.on('tradeProposed', function(tradeID, otherClient) {
  console.log('tradeProposed');
  steamTrading.respondToTrade(tradeID, true);
});

steamTrading.on('sessionStart', function(otherClient) {
  inventory = [];
  scrap = [];
  weapons = 0;
  addedScrap = [];
  client = otherClient;
  
  console.log('trading ' + steamFriends.personaStates[client].player_name);
  steamTrade.open(otherClient);
  steamTrade.loadInventory(440, 2, function(inv) {
    inventory = inv;
    scrap = inv.filter(function(item) { return item.name == 'Scrap Metal';});
// console.log(scrap);
  });
});

steamTrade.on('offerChanged', function(added, item) {
// console.log(item);
  console.log('they ' + (added ? 'added ' : 'removed ') + item.name);
  console.log(item);
  if (item.tags && item.tags.some(function(tag) {
    return ~['primary', 'secondary', 'melee', 'pda2'].indexOf(tag.internal_name);
  }) && (item.descriptions === '' || !item.descriptions.some(function(desc) {
    return desc.value == '( Not Usable in Crafting )';
  }))) {
    // this is a craftable weapon
    weapons += added ? 1 : -1;
    if (addedScrap.length != Math.floor(weapons / 2)) {
      // need to change number of scrap
      if (added && scrap.length > addedScrap.length) {
        console.log('adding scrap');
        var newScrap = scrap[addedScrap.length];
        steamTrade.addItems([newScrap]);
        addedScrap.push(newScrap);
      } else if (!added && addedScrap.length > Math.floor(weapons / 2)) {
        console.log('removing scrap');
        var scrapToRemove = addedScrap.pop();
        steamTrade.removeItem(scrapToRemove);
      }
    }
  }
});

steamTrade.on('end', function(result) {console.log('trade', result);});

steamTrade.on('ready', function() {
  console.log('readying');
  steamTrade.ready(function() {
    console.log('confirming');
    steamTrade.confirm();
  });
});

steamTrade.on('chatMsg', function(msg) {
  if (msg == 'give' && client == admin) {
    var nonScrap = inventory.filter(function(item) {
      return !~scrap.indexOf(item);
    });
    steamTrade.addItems(nonScrap);
  }
});
