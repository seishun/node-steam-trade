module.exports = SteamTrade;

require('util').inherits(SteamTrade, require('events').EventEmitter);

function SteamTrade() {
  require('events').EventEmitter.call(this);
}

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
    clearTimeout(this._timerTradePoll);
    
    if (!res.body.success) {
      this.emit('debug', 'trade fail');
      callback(res.body);
      return;
    }
    
    if (res.body.trade_status !== 0) {
      
      if (res.body.trade_status == 1) {
        require('superagent')
          .get('http://steamcommunity.com/trade/' + res.body.tradeid + '/receipt/')
          .set('Cookie', this.cookie)
          .end(function(res) {
            this.emit('end', 'complete', (res.text
              .match(/oItem = [\s\S]+?amount = \d+;\r\n\toItem/g) || [])
              .map(eval)
            );
          }.bind(this));
      
      } else {
        this.emit('end', {
          3: 'cancelled',
          4: 'timeout',
          5: 'failed'
        }[res.body.trade_status]);
      }
      
      return;
    }
    
    this._timerTradePoll = setTimeout(function() {
      this._send('tradestatus', {
        logpos: this._nextLogPos,
        version: this._version
      });
    }.bind(this), 1000);
    
    if (res.body.newversion)
      // we can update our own assets safely
      this._meAssets = res.body.me.assets;
    
    // callback now, otherwise we might return (loading inventory) and never get there
    callback(res.body);
    
    if (this._loadingInventoryData) {
      // we'll receive the same events again
      return;
    }
    
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
          var inventory = this._themInventories[event.appid] && this._themInventories[event.appid][event.contextid];
          if (!inventory) {
            require('superagent')
              .post('http://steamcommunity.com/trade/' + this._tradePartnerSteamID + '/foreigninventory')
              .set('Cookie', this.cookie)
              .set('Referer', 'http://steamcommunity.com/trade/1')
              .type('form')
              .on('error', function(error) {
                self.emit('debug', error);
                // retry on next status update
                this._loadingInventoryData = false;
              })
              .send({
                sessionid: this.sessionID,
                steamid: this._tradePartnerSteamID,
                appid: event.appid,
                contextid: event.contextid
              })
              .end(this._onLoadInventory(event.appid, event.contextid));
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

SteamTrade.prototype._send = function(action, data, callback) {
  clearTimeout(this._timerTradePoll);
  
  var self = this;
  
  require('superagent')
    .post('http://steamcommunity.com/trade/' + this._tradePartnerSteamID + '/' + action)
    .set('Cookie', this.cookie)
    .set('Referer', 'http://steamcommunity.com/trade/1')
    .type('form')
    .send({
      sessionid: this.sessionID
    })
    .send(data)
    .on('error', function(error) {
      self.emit('debug', error);
      self._send(action, data, callback);
    })
    .end(this._onTradeStatusUpdate(function(res) {
      if (!res.success) {
        var err = new Error('Invalid cookie');
        err.cont = function() {
          self._send(action, data, callback);
        }
        self.emit('error', err);
        
      } else if (callback) {
        callback(res);
      }
    }));  
};


SteamTrade.prototype.open = function(steamID, callback) {
  this._tradePartnerSteamID = steamID;
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

SteamTrade.prototype.loadInventory = function(appid, contextid, callback) {
  require('superagent')
    .get('http://steamcommunity.com/my/inventory/json/' + appid + '/' + contextid)
    .set('Cookie', this.cookie)
    .on('error', function(error) {
      self.emit('debug', error);
      self.loadInventory(appid, contextid, callback);
    })
    .end(function(res) {
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
  }, callback);
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
    
    if (!status.me.confirmed && status.me.ready && status.them.ready) {
      this.emit('debug', 'Steam dumbed');
      this.confirm(callback);
    }
  }.bind(this));
};
