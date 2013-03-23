module.exports = SteamTrade;

var request = require('request');
var j = request.jar();
request = request.defaults({jar:j});

require('util').inherits(SteamTrade, require('events').EventEmitter);

function SteamTrade() {
  require('events').EventEmitter.call(this);
}

SteamTrade.prototype._loadForeignInventory = function(appid, contextid) {
  var self = this;
  
  request.post({
    uri: 'http://steamcommunity.com/trade/' + this.tradePartnerSteamID + '/foreigninventory',
    headers: {
      referer: 'http://steamcommunity.com/trade/1'
    },
    form: {
      sessionid: this.sessionID,
      steamid: this.tradePartnerSteamID,
      appid: appid,
      contextid: contextid
    },
    json: true
  }, function(error, response, body) {
    if (error) {
      self.emit('debug', 'loading inventory: ' + error);
      // retry
      self._loadForeignInventory(appid, contextid);
      return;
    }
    
    for (var id in body.rgInventory) {
      var item = body.rgInventory[id];
      var description = body.rgDescriptions[item.classid + '_' + item.instanceid];
      for (var key in description) {
        item[key] = description[key];
      }
    }
    
    if (!self._themInventories[appid]) {
      self._themInventories[appid] = {};
    }
    self._themInventories[appid][contextid] = body.rgInventory;
    
    self._loadingInventoryData = false;
  });
};

SteamTrade.prototype._onTradeStatusUpdate = function(body, callback) {  
  clearTimeout(this._timerTradePoll);
  
  var self = this;
  
  if (body.success && body.trade_status !== 0) {
    
    if (callback) {
      // callback before emitting events
      callback(body);
    }
    
    if (body.trade_status == 1) {
      this.emit('end', 'complete', function getItems(callback) {
        request.get('http://steamcommunity.com/trade/' + body.tradeid + '/receipt/', function(error, response, body) {
          if (error || response.statusCode != 200) {
            self.emit('debug', 'Opening receipt page: ' + (error || response.statusCode));
            getItems(callback);
            return;
          }
          
          var items = [];
          
          // prepare to execute the script in the page
          var UserYou;
          function BuildHover(str, item) {
            items.push(item);
          }
          function $() {
            return {
              show: function() {}
            };
          }
          
          // evil magic happens here
          eval(body.match(/(var oItem;[\s\S]*)<\/script>/)[1]);
          
          callback(items);
        });
      });
    } else {
      this.emit('end', {
        3: 'cancelled',
        4: 'timeout',
        5: 'failed',
        undefined: 'canceled'
      }[body.trade_status]);
    }
    
    delete this.tradePartnerSteamID;
    return;
  }
  
  this._timerTradePoll = setTimeout(function() {
    self._send('tradestatus', {
      logpos: self._nextLogPos,
      version: self._version
    }, function(status) {
      if (!status.success) {
        // assume session lost, stop polling
        self.emit('debug', JSON.stringify(status));
        clearTimeout(self._timerTradePoll);
        var err = new Error('Invalid cookie');
        self.emit('error', err);
      }
    });
  }, 1000);
  
  if (body.newversion)
    // we can update our own assets safely
    this._meAssets = body.me.assets;
  
  if (callback) {
    // callback now, otherwise we might return (loading inventory) and never get there
    callback(body);
  }
  
  if (this._loadingInventoryData) {
    // we'll receive the same events again
    return;
  }
  
  var ready = false;
  
  // events might be undefined, but it's fine
  for (var i in body.events) {
    if (i < this._nextLogPos)
      continue;
    
    var event = body.events[i];
    
    if (event.steamid != this.tradePartnerSteamID)
      continue; // not interested in our own actions
    
    switch (event.action) {
      case '0':
      case '1':
        var inventory = this._themInventories[event.appid] && this._themInventories[event.appid][event.contextid];
        if (!inventory) {
          this._loadForeignInventory(event.appid, event.contextid);
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
  
  if (body.newversion) {
    // now that we know we have all inventories, we can update their assets too
    this._themAssets = body.them.assets;
    this._version = body.version;
  }
  
  if (ready)
    this.emit('ready');
};

SteamTrade.prototype._send = function(action, data, callback) {
  clearTimeout(this._timerTradePoll);
  
  data.sessionid = this.sessionID;
  
  var self = this;
  
  request.post({
    uri: 'http://steamcommunity.com/trade/' + this.tradePartnerSteamID + '/' + action,
    headers: {
      referer: 'http://steamcommunity.com/trade/1'
    },
    form: data,
    json: true
  }, function(error, response, body) {
    if (!self.tradePartnerSteamID) {
      // trade is over already
      return;
    }
    
    if (error || response.statusCode != 200) {
      self.emit('debug', 'sending ' + action + ': ' + (error || response.statusCode));
      // retry
      self._send(action, data, callback);
      return;
    }
    
    self._onTradeStatusUpdate(body, callback);
    return;
  });
};

SteamTrade.prototype.setCookie = function(cookie) {
  j.add(request.cookie(cookie));
};

SteamTrade.prototype.open = function(steamID, callback) {
  this.tradePartnerSteamID = steamID;
  this._themInventories = {};
  this._themAssets = [];
  this._meAssets = [];
  this._nextLogPos = 0;
  this._version = 1;
  
  this._send('tradestatus', {
    logpos: this._nextLogPos,
    version: this._version
  }, callback);
};

SteamTrade.prototype.getContexts = function(callback) {
  request.get('http://steamcommunity.com/trade/' + this.tradePartnerSteamID, function(error, response, body) {
    callback(JSON.parse(body.match(/var g_rgAppContextData = (.*);/)[1]));
  });
};

SteamTrade.prototype.loadInventory = function(appid, contextid, callback) {
  request.get({
    uri: 'http://steamcommunity.com/my/inventory/json/' + appid + '/' + contextid,
    json: true
  }, function(error, response, body) {
    if (error) {
      this.emit('debug', 'loading my inventory: ' + error);
      this.loadInventory(appid, contextid, callback);
      return;
    }
    callback(mergeWithDescriptions(body.rgInventory, body.rgDescriptions, contextid)
      .concat(mergeWithDescriptions(body.rgCurrency, body.rgDescriptions, contextid)));
  }.bind(this));
};

function mergeWithDescriptions(items, descriptions, contextid) {
  return Object.keys(items).map(function(id) {
    var item = items[id];
    var description = descriptions[item.classid + '_' + (item.instanceid || '0')];
    for (var key in description) {
      item[key] = description[key];
    }
    // add contextid because Steam is retarded
    item.contextid = contextid;
    return item;
  });
}

SteamTrade.prototype.themAssets = function() {
  return this._themAssets.map(function(item) {
    return this._themInventories[item.appid][item.contextid][item.assetid];
  }.bind(this));
};

SteamTrade.prototype.addItems = function(items, callback) {
  var count = items.length;
  var slot = 0;
  var results = [];
  
  items.forEach(function(item, index) {
    // find first free slot
    for (; this._meAssets && slot in this._meAssets; slot++);
    
    this._send(item.is_currency ? 'setcurrency' : 'additem', {
      appid: item.appid,
      contextid: item.contextid,
      
      itemid: item.id,
      currencyid: item.id,
      
      slot: slot++, // it's taken tentatively
      amount: item.amount
    }, function(res) {
      results[index] = res;
      if (!--count) {
        callback && callback(results);
      }
    });
  }.bind(this));
};

SteamTrade.prototype.removeItem = function(item, callback) {
  this._send('removeitem', {
    appid: item.appid,
    contextid: item.contextid,
    itemid: item.id
  }, callback);
};

SteamTrade.prototype.ready = function(callback) {
  this._send('toggleready', {
    version: this._version,
    ready: true
  }, callback);
};

SteamTrade.prototype.unready = function(callback) {
  this._send('toggleready', {
    version: this._version,
    ready: false
  }, callback);
};

SteamTrade.prototype.confirm = function(callback) {
  this._send('confirm', {
    logpos: this._nextLogPos,
    version: this._version
  }, function(status) {
    // sometimes Steam is dumb and ignores the confirm for no apparent reason
    // so we'll have to resend the confirm if this one failed
    // but only if it _should_ have worked
    
    if (status.trade_status !== 0) {
      // trade is over
      return;
    }
    
    if (!status.me.confirmed && status.me.ready && status.them.ready) {
//      this.emit('debug', 'Steam dumbed');
      this.confirm(callback);
    }
  }.bind(this));
};

SteamTrade.prototype.cancel = function(callback) {
  this._send('cancel', {}, callback);
};
