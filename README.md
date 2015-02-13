# Steam trading for Node.js

Allows you to automate Steam trading in Node.js.

# Installation

```
npm install git://github.com/seishun/node-steam-trade.git
```

# Usage
First, instantiate a SteamTrade object:

```js
var SteamTrade = require('steam-trade');
var steamTrade = new SteamTrade();
```

Before you use it, make sure it has the necessary session information. See [`sessionID`](#sessionid) and [setCookie](#setcookiecookie).

Unless specified otherwise, callbacks receive the parsed JSON response from Steam as the first argument (`res` in this example). You can use it for error checking: if something went wrong, `res.success` will be `false` and `res.error` should be a human-readable string. 

## Properties

### sessionID
Must be a valid web session ID. You can either log into steamcommunity.com manually and use the value of the "sessionid" cookie, or, if using [node-steam](https://github.com/seishun/node-steam), listen for its ['webSessionID'](https://github.com/seishun/node-steam#websessionid) event.

### themAssets
An array of the other party's offered items. The order of items in the array corresponds to their order in the trade window, but empty spaces are not preserved.

### tradePartnerSteamID
Your trade partner's SteamID if a trade is ongoing or was interrupted (see ['error' event](#error)), otherwise a falsy value.

## Methods

### setCookie(cookie)
Sets a cookie that must be in the "name=value" form. SteamTrade needs the "steamLogin" and "sessionid" cookies to operate. You can either log into steamcommunity.com manually, or, if using node-steam, use its [webLogOn](https://github.com/seishun/node-steam#weblogoncallback) method to get both cookies in the required form.

### loadInventory(appid, contextid, callback)
Loads your inventory for the given app and context. For example, use 440 and 2 for TF2, or 570 and 2 for Dota 2. The specified inventory must already exist for this account, use [getContexts](#getcontextscallback) if you need to check it at runtime. The first argument to `callback` will be an array of item objects in case of success, otherwise a falsy value. Failure implies that your cookie has expired (see ['error' event](#error)).

### getContexts(callback)
Gets the list of available contexts. The first argument to `callback` will be the `g_rgAppContextData` object extracted from the trading page (its structure can be more easily understood from a look at it rather from a description) in case of success, otherwise a falsy value. Failure implies that your cookie has expired (see ['error' event](#error)).

### open(steamID, [callback])
Initializes a trade with the specified SteamID. The trade handshake must have completed at this point - in node-steam, listen for a `sessionStarted` event. Don't use any other methods until you've opened a trade. Use `callback` if you want to add some items immediately after opening the trade.

### addItem(item, [callback])
Adds the specified item from your inventory. If the item is stackable (Spiral Knights crap), it will add the whole available amount. If you want to add a certain amount, modify the item's `amount` property.

Readying won't work if any of your added items' callbacks haven't fired yet. If you are adding multiple items, [async.each](https://github.com/caolan/async#each) or [async.map](https://github.com/caolan/async#map) might be useful.

### addItems(items, [callback])
**Deprecated: use [addItem](#additemitem-callback) instead.**

Adds the specified items from your inventory. `items` must be an array. `callback` will be called once all the items have been added. It will be provided an array of responses - one for each added item, in the same order.

### removeItem(item, [callback])
Removes a single item from the trade.

### ready([callback])
Presses the big blue "ready" button. Again, use the callback if you want to confirm as well.

### unready([callback])
Unpresses the "ready" button.

### confirm([callback])
Presses the big green "Make Trade" button. Will silently fail if either side is not ready.

### cancel([callback])
Cancels the trade. Stops polling if succeeds, so no 'end' event will be emitted.

### chatMsg(msg, [callback])
Sends a trade chat message.


## Events

### 'error'
* `e` - an `Error` object

node-steam-trade has received a bad response while polling, assumed that your cookie has expired, and stopped polling. A possible cause is that you logged into this account from a browser on another computer.

Refresh your web session (`webLogOn` in node-steam), call `setCookie` with the new cookies, then resume polling by reopening the trade (just call `trade.open(trade.tradePartnerSteamID)` and the existing trade will continue).

### 'end'
* 'complete', 'empty' (no items on either side), 'cancelled', 'timeout', 'failed' or 'pending' (trade turned into a trade offer)
* in case of 'complete', a `getItems` function; in case of 'pending', trade offer ID

Trade is closed. If you want to get the list of received items, call `getItems` with a callback. The first argument to the callback will be an array of items in case of success, otherwise a falsy value. Failure implies that your cookie has expired (see ['error' event](#error)).

```js
trade.on('end', function(status, getItems) {
  if (status == 'complete') {
    getItems(function(items) {
      console.log(items);
    });
  }
});
```

### 'offerChanged'
* `true` if an item was added, `false` if removed
* the item object

The [`themAssets` property](#themassets) will be updated on the next tick.

### 'ready'
The other side has pressed the big blue "ready" button.

### 'unready'
The other side has changed their mind.

### 'chatMsg'
They said something in the trade chat.
