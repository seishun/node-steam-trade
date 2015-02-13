module.exports = SteamTrade;

var request = require('request');

require('util').inherits(SteamTrade, require('events').EventEmitter);

function SteamTrade() {
  require('events').EventEmitter.call(this);
  
  this._j = request.jar();
  this._request = request.defaults({jar:this._j});
}

SteamTrade.prototype._loadForeignInventory = function(appid, contextid) {
  if (!this._themInventories[appid]) {
    this._themInventories[appid] = {};
  }
  if (!this._themInventories[appid][contextid]) {
    this._themInventories[appid][contextid] = {};
  }
  
  var self = this;
  
  this._request.get({
    uri: 'http://steamcommunity.com/trade/' + this.tradePartnerSteamID + '/foreigninventory?' + require('querystring').stringify({
      sessionid: this.sessionID,
      steamid: this.tradePartnerSteamID,
      appid: appid,
      contextid: contextid
    }),
    headers: {
      referer: 'http://steamcommunity.com/trade/1'
    },
    json: true
  }, function continueFullInventoryRequestIfNecessary(error, response, body) {
    if (error) {
      self.emit('debug', 'loading inventory: ' + error);
      // retry
      self._loadForeignInventory(appid, contextid);
      return;
    }
    
    for (var id in body.rgInventory) {
      var item = self._themInventories[appid][contextid][id] = body.rgInventory[id];
      var description = body.rgDescriptions[item.classid + '_' + item.instanceid];
      for (var key in description) {
        item[key] = description[key];
      }
    }
    
    if (body.more) {
      self.emit('debug', 'loading inventory: continuing from ' + body.more_start);
      self._request.get({
        uri: 'http://steamcommunity.com/trade/' + self.tradePartnerSteamID + '/foreigninventory?' + require('querystring').stringify({
          sessionid: self.sessionID,
          steamid: self.tradePartnerSteamID,
          appid: appid,
          contextid: contextid,
          start: body.more_start
        }),
        headers: {
          referer: 'http://steamcommunity.com/trade/1'
        },
        json: true
      }, continueFullInventoryRequestIfNecessary);
      return;
    }
    
    self._loadingInventoryData = false;
  });
};

SteamTrade.prototype._onTradeStatusUpdate = function(body, callback) {  
  clearTimeout(this._timerTradePoll);
  
  var self = this;
  
  if (body.trade_status > 0) {
    
    if (callback) {
      // callback before emitting events
      callback(body);
    }
    
    if (body.trade_status == 1) {
      this.emit('end', 'complete', function getItems(callback) {
        self._request.get('http://steamcommunity.com/trade/' + body.tradeid + '/receipt/', function(error, response, body) {
          if (error || response.statusCode != 200) {
            self.emit('debug', 'Opening receipt page: ' + (error || response.statusCode));
            getItems(callback);
            return;
          }
          
          var script = body.match(/(var oItem;[\s\S]*)<\/script>/);
          if (!script) {
            // no session
            callback();
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
          eval(script[1]);
          
          callback(items);
        });
      });
    } else {
      this.emit('end', {
        2: 'empty', // happens when both parties confirm a trade with no items on either side
        3: 'cancelled',
        4: 'timeout',
        5: 'failed',
        6: 'pending',
      }[body.trade_status], body.tradeid);
    }
    
    delete this.tradePartnerSteamID;
    return;
  }
  
  this._timerTradePoll = setTimeout(function() {
    self._send('tradestatus', {
      logpos: self._nextLogPos,
      version: self._version
    }, function(status) {
      // account for { trade_status: 2, success: false } which is not an error
      if (!status.success && !status.trade_status) {
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
    this._meAssets = body.me.assets || []; // Valve uses '' to denote an empty array
  
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
    // it can be '', [item, item], or {'1': item, '3': item}
    this.themAssets = body.them.assets ? Object.keys(body.them.assets).map(function(key) {
      var item = body.them.assets[key];
      return self._themInventories[item.appid][item.contextid][item.assetid];
    }) : [];
    this._version = body.version;
  }
  
  if (ready)
    this.emit('ready');
};

SteamTrade.prototype._send = function(action, data, callback) {
  clearTimeout(this._timerTradePoll);
  
  data.sessionid = this.sessionID;
  
  var self = this;
  
  this._request.post({
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
  this._j.setCookie(request.cookie(cookie), 'http://steamcommunity.com');
};

SteamTrade.prototype.open = function(steamID, callback) {
  this.tradePartnerSteamID = steamID;
  this.themAssets = [];
  this._themInventories = {};
  this._meAssets = [];
  this._nextLogPos = 0;
  this._version = 1;
  
  this._send('tradestatus', {
    logpos: this._nextLogPos,
    version: this._version
  }, callback);
};

SteamTrade.prototype.getContexts = function(callback) {
  this._request.get('http://steamcommunity.com/trade/' + this.tradePartnerSteamID, function(error, response, body) {
    var appContextData = body.match(/var g_rgAppContextData = (.*);/);
    callback(appContextData && JSON.parse(appContextData[1]));
  });
};

SteamTrade.prototype.loadInventory = function(appid, contextid, callback) {
  var inventory = [];
  
  this._request.get({
    uri: 'http://steamcommunity.com/my/inventory/json/' + appid + '/' + contextid,
    json: true
  }, function continueFullInventoryRequestIfNecessary(error, response, body) {
    if (error || response.statusCode != 200 || JSON.stringify(body) == '{}') { // the latter happens when GC is down
      this.emit('debug', 'loading my inventory: ' + (error || (response.statusCode != 200 ? response.statusCode : '{}')));
      this.loadInventory(appid, contextid, callback);
      return;
    }
    if (typeof body != 'object') {
      // no session
      callback();
      return;
    }
    inventory = inventory
      .concat(mergeWithDescriptions(body.rgInventory, body.rgDescriptions, contextid))
      .concat(mergeWithDescriptions(body.rgCurrency, body.rgDescriptions, contextid));
    if (body.more) {
      this.emit('debug', 'loading my inventory: continuing from ' + body.more_start);
      this._request.get({
        uri: 'http://steamcommunity.com/my/inventory/json/' + appid + '/' + contextid + '?start=' + body.more_start,
        json: true
      }, continueFullInventoryRequestIfNecessary.bind(this));
    } else {
      callback(inventory);
    }
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

SteamTrade.prototype.addItem = function(item, callback) {
  // find first free slot
  for (var slot = 0; slot in this._meAssets; slot++);
  
  this._meAssets[slot] = item; // prevent using this slot at least until the next version
  
  this._send(item.is_currency ? 'setcurrency' : 'additem', {
    appid: item.appid,
    contextid: item.contextid,
    
    itemid: item.id,
    currencyid: item.id,
    
    slot: slot,
    amount: item.amount
  }, callback);
};

SteamTrade.prototype.addItems = function(items, callback) {
  var count = items.length;
  var slot = 0;
  var results = [];
  
  items.forEach(function(item, index) {
    // find first free slot
    for (; slot in this._meAssets; slot++);
    
    this._meAssets[slot] = item; // prevent using this slot at least until the next version
    
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
    
    if (status.trade_status === 0 && !status.me.confirmed && status.me.ready && status.them.ready) {
//      this.emit('debug', 'Steam dumbed');
      this.confirm(callback);
      return;
    }
    
    callback && callback(status);
  }.bind(this));
};

SteamTrade.prototype.cancel = function(callback) {
  this._send('cancel', {}, function(res) {
    if (res.success) {
      // stop polling
      delete this.tradePartnerSteamID;
    }
    callback && callback(res);
  }.bind(this));
};

SteamTrade.prototype.chatMsg = function(msg, callback) {
  this._send('chat', {
    message: msg,
    logpos: this._nextLogPos,
    version: this._version
  }, callback);
};
