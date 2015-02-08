var logOnDetails = {
  accountName: '',
  password: ''
};

if (require('fs').existsSync('sentry'))
  logOnDetails.shaSentryfile = require('fs').readFileSync('sentry');

// logOnDetails.authCode = ''; // code received by email

var admin = ''; // put your steamid here to say 'give' to the bot and receive all non-scrap items


var Steam = require('steam');
var SteamTrade = require('./'); // change to 'steam-trade' if not running from the same directory

var steam = new Steam.SteamClient();
var steamTrade = new SteamTrade();

steam.logOn(logOnDetails);

steam.on('debug', console.log);

steam.on('loggedOn', function(result) {
  console.log('Logged in!');
  steam.setPersonaState(Steam.EPersonaState.Online);
});

steam.on('webSessionID', function(sessionID) {
  console.log('got a new session ID:', sessionID);
  steamTrade.sessionID = sessionID;
  steam.webLogOn(function(cookies) {
    console.log('got a new cookie:', cookies);
    cookies.forEach(function(cookie) {
        steamTrade.setCookie(cookie);
    });
  });
});

var inventory;
var scrap;
var weapons;
var addedScrap;
var client;

steam.on('tradeProposed', function(tradeID, otherClient) {
  console.log('tradeProposed');
  steam.respondToTrade(tradeID, true);
});

steam.on('sessionStart', function(otherClient) {
  inventory = [];
  scrap = [];
  weapons = 0;
  addedScrap = [];
  client = otherClient;
  
  console.log('trading ' + steam.users[client].playerName);
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
