function SteamTrade(sessionID, token) {
  require('events').EventEmitter.call(this);
  
  this._sessionID = sessionID;
  this._cookie = require('util').format('sessionid=%s; steamLogin=%s', sessionID, token);
}

require('util').inherits(SteamTrade, require('events').EventEmitter);


SteamTrade.prototype._onLoadInventory = function(appid, contextid) {
  return function(res) {
    for (var id in res.body.rgInventory) {
      var item = res.body.rgInventory[id];
      var description = res.body.rgDescriptions[item.classid + '_' + item.instanceid];
      for (var key in description) {
        item[key] = description[key];
      }
    }
    
    if (!this._themInventories[appid]) {
      this._themInventories[appid] = {};
    }
    this._themInventories[appid][contextid] = res.body.rgInventory;
    
    this._loadingInventoryData = false;
  }.bind(this);
};

SteamTrade.prototype._onTradeStatusUpdate = function(callback) {
  return function(res) {
//    console.log(res.body);
    if (res.body.trade_status !== 0) {
      this.emit({
        1: 'complete',
        3: 'cancelled',
        4: 'timeout',
        5: 'failed'
      }[res.body.trade_status]);
      
      clearInterval(this._timerTradePoll);
      return;
    }
    
    if (res.body.newversion)
      // we can update our own assets safely
      this._meAssets = res.body.me.assets;
    
    if (callback)
      // callback now, otherwise we might return (loading inventory) and never get there
      callback(res.body);
    
    if (this._loadingInventoryData)
      // we'll receive the same events again
      return;
    
    var ready = false;
    
    // events might be undefined, but it's fine
    for (var i in res.body.events) {
      if (i < this._nextLogPos)
        continue;
      
      var event = res.body.events[i];
      
      if (event.steamid != this._tradePartnerSteamID)
        continue; // not interested in our own actions
      
      switch (event.action) {
        case '0':
        case '1':
          // item added or removed
          var inventory = this._themInventories[event.appid] && this._themInventories[event.appid][event.contextid];
          if (!inventory) {
            this._send('foreigninventory', {
              steamid: this._tradePartnerSteamID,
              appid: event.appid,
              contextid: event.contextid
            }, this._onLoadInventory(event.appid, event.contextid));
            this._loadingInventoryData = true;
            return;
          }
          this.emit('offerChanged', event.action == '0', inventory[event.assetid]);
          break;
        case '2':
          // defer 'ready' event until we've handled anything else
          ready = true;
          break;
        case '3':
          ready = false;
          this.emit('unready');
          break;
        case '7':
          this.emit('chatMsg', event.text);
      }
    }
    
    if (i >= this._nextLogPos)
      this._nextLogPos = ++i;
    
    if (res.body.newversion) {
      // now that we know we have all inventories, we can update their assets too
      this._themAssets = res.body.them.assets;
      this._version = res.body.version;
    }
    
    if (ready)
      this.emit('ready');
  
  }.bind(this);
};

SteamTrade.prototype._send = function(action, data, handler) {
  require('superagent')
    .post('http://steamcommunity.com/trade/' + this._tradePartnerSteamID + '/' + action)
    .set('Cookie', this._cookie)
    .set('Referer', 'http://steamcommunity.com/trade/1')
    .type('form')
    .send({
      sessionid: this._sessionID
    })
    .send(data)
    .end(handler);
};


SteamTrade.prototype.open = function(steamID) {
  this._tradePartnerSteamID = steamID;
  this._themInventories = {};
  this._themAssets = [];
  this._meAssets = [];
  this._nextLogPos = 0;
  this._version = 1;
  this._timerTradePoll = setInterval(function() {
    this._send('tradestatus', {
      logpos: this._nextLogPos,
      version: this._version
    }, this._onTradeStatusUpdate());
  }.bind(this), 1000);
};

SteamTrade.prototype.loadInventory = function(appid, contextid, callback) {
  require('superagent')
    .get('http://steamcommunity.com/my/inventory/json/' + appid + '/' + contextid)
    .set('Cookie', this._cookie)
    .end(function(res) {
//      console.log(res.body);
      callback(Object.keys(res.body.rgInventory).map(function(id) {
        var item = res.body.rgInventory[id];
        var description = res.body.rgDescriptions[item.classid + '_' + item.instanceid];
        for (var key in description) {
          item[key] = description[key];
        }
        // add contextid because Steam is retarded
        item.contextid = contextid;
        return item;
      }));
    });
};

SteamTrade.prototype.themAssets = function() {
  return this._themAssets.map(function(item) {
    return this._themInventories[item.appid][item.contextid][item.assetid];
  }.bind(this));
};

SteamTrade.prototype.addItem = function(item, callback, slot) {
  // find first free slot
  if (slot === undefined) {
    if (this._meAssets === '') // it can be either an array, a string or an object -_-
      slot = 0;
    else
      for (slot = 0; slot in this._meAssets; slot++);
  }
  
  this._send('additem', {
    appid: item.appid,
    contextid: item.contextid,
    itemid: item.id,
    slot: slot
  }, this._onTradeStatusUpdate(callback));
};

SteamTrade.prototype.removeItem = function(item, callback) {
  this._send('removeitem', {
    appid: item.appid,
    contextid: item.contextid,
    itemid: item.id
  }, this._onTradeStatusUpdate(callback));
};

SteamTrade.prototype.ready = function(callback) {
  this._send('toggleready', {
    version: this._version,
    ready: true
  }, this._onTradeStatusUpdate(callback));
};

SteamTrade.prototype.confirm = function(callback) {
  this._send('confirm', {
    logpos: this._nextLogPos,
    version: this._version
  }, this._onTradeStatusUpdate(function(status) {
    // sometimes Steam is dumb and ignores the confirm for no apparent reason
    // so we'll have to resend the confirm if this one failed
    // but only if it _should_ have worked
    
    if (!status.me.confirmed && status.me.ready && status.them.ready) {
//      console.log('Steam dumbed');
//      console.log(status);
      this.confirm(callback);
    }
  }.bind(this)));
};


module.exports = SteamTrade;