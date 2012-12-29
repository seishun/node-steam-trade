var username = '';
var password = '';
var admin = ''; // put your steamid here to say 'give' to the bot and receive all non-scrap items


var Steam = require('steam');

var bot = new Steam.SteamClient();
bot.logOn(username, password);
bot.on('connected', function() {
  console.log('Connected!');
});

bot.on('debug', console.log);

bot.on('loggedOn', function(result) {
  console.log('Logged in!');
  
  bot.setPersonaState(Steam.EPersonaState.Online);
});

bot.on('chatInvite', function(chatRoomID, chatRoomName, patronID) {
  console.log('Got an invite to ' + chatRoomName + ' from ' + bot.users[patronID].playerName);
  bot.joinChat(chatRoomID);
});

bot.on('webLoggedOn', function(sessionId, token) {
  var inventory;
  var scrap;
  var weapons;
  var addedScrap;
  var client;
  
  console.log('authenticated on the web');
  var steamTrade = new (require('./'))(sessionId, token);
  
  bot.on('tradeProposed', function(tradeID, otherClient, otherName) {
    console.log('tradeProposed');
//    console.log(tradeID, otherClient, otherName);
    bot.respondToTrade(tradeID, true);
  });
  
  bot.on('tradeResult', function(tradeID, response, otherClient) {
    console.log('tradeResult');
//    console.log(tradeID, response, otherClient);
  });
  
  bot.on('sessionStart', function(otherClient) {
    inventory = [];
    scrap = [];
    weapons = 0;
    addedScrap = [];
    client = otherClient.toString();
    
    console.log('trading ' + bot.users[client].playerName);
    steamTrade.open(otherClient);
    steamTrade.loadInventory(440, 2, function(inv) {
      inventory = inv;
      scrap = inv.filter(function(item) { return item.name == 'Scrap Metal';});
//      console.log(scrap);
    });
  });
  
  steamTrade.on('offerChanged', function(added, item) {
//      console.log(item);
    console.log('they ' + (added ? 'added ' : 'removed ') + item.name)
    console.log(item);
    if (item.tags.some(function(tag) {
      return ['primary', 'secondary', 'melee', 'pda2'].indexOf(tag.internal_name) != -1;
    }) && (item.descriptions === '' || !item.descriptions.some(function(desc) {
      return desc.value == '( Not Usable in Crafting )';
    }))) {
      // this is a weapon
      weapons += added ? 1 : -1;
      if (addedScrap.length != Math.floor(weapons / 2)) {
        // need to change number of scrap
        if (added && scrap.length > addedScrap.length) {
          console.log('adding scrap')
          var newScrap = scrap[addedScrap.length];
          steamTrade.addItem(newScrap);
          addedScrap.push(newScrap);
        } else if (!added && addedScrap.length > Math.floor(weapons / 2)) {
          console.log('removing scrap')
          var scrapToRemove = addedScrap.pop();
          steamTrade.removeItem(scrapToRemove);
        }
      }
    }
  });
  
  steamTrade.on('complete', function() {console.log('trade complete');})
  steamTrade.on('cancelled', function() {console.log('trade canceled')});
  steamTrade.on('timeout', function() {console.log('trade timed out')});
  steamTrade.on('failed', function() {console.log('trade failed')});
  
  steamTrade.on('ready', function() {
    console.log('readying');
    steamTrade.ready(function() {
      console.log('confirming')
      steamTrade.confirm();
    });
  });
  
  steamTrade.on('chatMsg', function(msg) {
    if (msg == 'give' && client == admin) {
      (function addItem(i) {
        if (i in inventory) {
          if (scrap.indexOf(inventory[i]) == -1) {
            steamTrade.addItem(inventory[i], function() { addItem(i + 1); });
          } else {
            addItem(i + 1);
          }
        }
      })(0);
    }
  });
});
