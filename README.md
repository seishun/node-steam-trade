# Steam trading for Node.js

Allows you to automate Steam trading in Node.js.

# Usage
Instantiate a SteamTrade object using the sessionID and token returned from Steam after a successful web authentication. You can use [node-steam](https://github.com/seishun/node-steam)'s `webLoggedOn` event to get them.

Do not make multiple method calls at once (e.g. `addItem(derp); addItem(herp);`) - instead, make the second call in the callback provided to the first one (`addItem(derp, function() {addItem(herp);});`). The callback will be passed the raw JSON response object from Steam, in case you want it for some reason.

```js
var SteamTrade = require('./'); // if running from the same directory
var steamTrade = new SteamTrade('sessionID', 'token');
```

This is very beta and might break in the most unexpected ways. Bug reports and feedback are much appreciated.

See scrapbank.js for an even more beta scrapbank bot implementation (`npm install steam` to use).

# Methods

## open(steamID)
Initializes a trade with the specified SteamID. The trade handshake must have completed at this point - in node-steam, listen for a `sessionStarted` event. Don't use any other methods until you've opened a trade.

## loadInventory(appid, contextid, callback)
Loads your library for the given app and context, then calls `callback` with the inventory object. TODO: provide a list of available appids and contexids. For example, use 440 and 2 for TF2 and 570 and 2 for Dota2.

## themAssets()
Returns an array of the other party's offered items.

## addItem(item, [callback], [slot])
Adds the specified item from your inventory. Use callback to add multiple items. Specify the slot if you know what you're doing, otherwise it'll add to the first available slot.

## removeItem(item, [callback])
Same arguments as above.

## ready([callback])
Presses the big blue "ready" button. Again, use the callback if you want to confirm as well.

## confirm([callback])
Presses the big green "Make Trade" button. Will silently fail if either side is not ready.


# Events

## 'complete'
Trade finished successfully.

## 'cancelled', 'timeout', 'failed'
Trade finished unsuccessfully.

## 'offerChanged'
* `added` - `true` if item added, `false` if removed
* `item` - the item object

## 'ready'
The other side has pressed the big blue "ready" button.

## 'unready'
The other side has changed their mind.

## 'chatMsg'
They said something in the trade chat.
