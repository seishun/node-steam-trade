# Steam trading for Node.js

Allows you to automate Steam trading in Node.js.

# Installation

```
npm install git://github.com/seishun/node-steam-trade.git
```

# Usage
Instantiate a SteamTrade object...

```js
var SteamTrade = require('steam-trade');
var steamTrade = new SteamTrade();
```

...then do the following:

* Set its `sessionID` property to a valid web session ID. In [node-steam](https://github.com/seishun/node-steam), you can use the `webSessionID` event to get it.
* Call its `setCookie` method with each of your cookies. In node-steam, you can use the `webLogOn` method to get them.

Do not make multiple method calls in the same tick (e.g. `trade.addItems(items); trade.ready();`) - instead, make the second call in the callback provided to the first one (`trade.addItems(items, function(res) {trade.ready();});`). The callback will be passed the parsed JSON response from Steam (`res` in the example). You can use it for error checking: if something went wrong, `res.success` will be `false` and `res.error` should be a human-readable string. 


# Properties

## themAssets
An array of the other party's offered items. The order of items in the array corresponds to their order in the trade window, but empty spaces are not preserved.

## tradePartnerSteamID
Your trade partner's SteamID if a trade is ongoing or was interrupted (see ['error' event](#error)), otherwise a falsy value.

# Methods

## open(steamID, callback)
Initializes a trade with the specified SteamID. The trade handshake must have completed at this point - in node-steam, listen for a `sessionStarted` event. Don't use any other methods until you've opened a trade. Use `callback` if you want to add some items immediately after opening the trade.

## loadInventory(appid, contextid, callback)
Loads your library for the given app and context. For example, use 440 and 2 for TF2 and 570 and 2 for Dota2. The first argument to `callback` will be an array of item objects in case of success, otherwise a falsy value. Failure suggests that your cookie has expired (see ['error' event](#error)).

## getContexts(callback)
Gets the list of available contexts. The first argument to `callback` will be an object extracted directly from the trading page in case of success, otherwise a falsy value. Failure suggests that your cookie has expired (see ['error' event](#error)).

## addItems(items, [callback])
Adds the specified items from your inventory. `items` must be an array. Create an array of a single item if you only want to add one item. If any of the items are stackable (Spiral Knights crap), it will add the whole available amount. If want to add a certain amount, modify the item's `amount` property.

`callback` will be called once all the items have been added. It will be provided an array of responses - one for each added item, in the same order.

## removeItem(item, [callback])
Removes a single item from the trade.

## ready([callback])
Presses the big blue "ready" button. Again, use the callback if you want to confirm as well.

## unready([callback])
Unpresses the "ready" button.

## confirm([callback])
Presses the big green "Make Trade" button. Will silently fail if either side is not ready.

## cancel([callback])
Cancels the trade. Stops polling if succeeds, so no 'end' event will be emitted.

## chatMsg(msg, [callback])
Sends a trade chat message.


# Events

## 'error'
* `e` - an `Error` object

node-steam-trade has received a bad response while polling, assumed that your cookie has expired, and stopped polling. A possible cause is that you logged into this account from a browser on another computer.

Refresh your web session (`webLogOn` in node-steam), call `setCookie` with the new cookies, then resume polling by reopening the trade (just call `trade.open(trade.tradePartnerSteamID)` and the existing trade will continue).

## 'end'
* 'complete', 'empty' (no items on either side), 'cancelled', 'timeout' or 'failed' 
* in case of 'complete', a `getItems` function

Trade is closed. If you want to get the list of received items, call `getItems` with a callback. The first argument to the callback will be an array of items in case of success, otherwise a falsy value. Failure suggests that your cookie has expired (see ['error' event](#error)).

```js
trade.on('end', function(status, getItems) {
  if (status == 'complete') {
    getItems(function(items) {
      console.log(items);
    });
  }
});
```

## 'offerChanged'
* `true` if an item was added, `false` if removed
* the item object

The [`themAssets` property](#themassets) will be updated on the next tick.

## 'ready'
The other side has pressed the big blue "ready" button.

## 'unready'
The other side has changed their mind.

## 'chatMsg'
They said something in the trade chat.
