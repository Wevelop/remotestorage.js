define(['./getputdelete', './util'], function (getputdelete, util) {

  "use strict";

  var prefix = 'remote_storage_wire_';

  var events = util.getEventEmitter('connected', 'error');

  function set(key, value) {
    localStorage.setItem(prefix+key, JSON.stringify(value));

    if(getState() == 'connected') {
      events.emit('connected');
    }
  }
  function remove(key) {
    localStorage.removeItem(prefix+key);
  }
  function get(key) {
    var valStr = localStorage.getItem(prefix+key);
    if(typeof(valStr) == 'string') {
      try {
        return JSON.parse(valStr);
      } catch(e) {
        localStorage.removeItem(prefix+key);
      }
    }
    return null;
  }
  function disconnectRemote() {
    remove('storageType');
    remove('storageHref');
    remove('bearerToken');
  }
  function getState() {
    if(get('storageType') && get('storageHref')) {
      if(get('bearerToken')) {
        return 'connected';
      } else {
        return 'authing';
      }
    } else {
      return 'anonymous';
    }
  }
  function on(eventType, cb) {
    events.on(eventType, cb);
  }

  function resolveKey(storageType, storageHref, basePath, relPath) {
    var item = ((basePath.length?(basePath + '/'):'') + relPath);
    return storageHref + item;
  }
  function setChain(driver, hashMap, mimeType, token, cb, timestamp) {
    var i;
    for(i in hashMap) {
      break;
    }
    if(i) {
      var thisOne = hashMap[i];
      delete hashMap[i];
      driver.set(i, thisOne, mimeType, token, function(err, timestamp) {
        if(err) {
          cb(err);
        } else {
          setChain(driver, hashMap, mimeType, token, cb, timestamp);
        }
      });
    } else {
      cb(null, timestamp);
    }
  }

  // Namespace: wireClient
  //
  // The wireClient stores the user's storage information and controls getputdelete accordingly.
  //
  // Event: connected
  //
  // Fired once everything is configured.
  return {

    // Method: get
    //
    // Get data from given path from remotestorage
    //
    // Parameters:
    //   path     - absolute path (starting from storage root)
    //   callback - see <getputdelete.get> for details on the callback parameters
    get: function (path, cb) {
      var storageType = get('storageType'),
        storageHref = get('storageHref'),
        token = get('bearerToken');
      if(typeof(path) != 'string') {
        cb('argument "path" should be a string');
      } else {
        getputdelete.get(resolveKey(storageType, storageHref, '', path), token, cb);
      }
    },

    // Method: set
    //
    // Write data to given path in remotestorage
    //
    // Parameters:
    //   path     - absolute path (starting from storage root)
    //   valueStr - raw data to write
    //   mimeType - MIME type to set as Content-Type header
    //   callback - see <getputdelete.set> for details on the callback parameters.
    set: function (path, valueStr, mimeType, cb) {
      var storageType = get('storageType'),
        storageHref = get('storageHref'),
        token = get('bearerToken');
      if(typeof(path) != 'string') {
        cb('argument "path" should be a string');
      } else {
        getputdelete.set(resolveKey(storageType, storageHref, '', path), valueStr, mimeType, token, cb);
      }
    },

    // Method: setStorageInfo
    //
    // Configure wireClient.
    //
    // Parameters:
    //   type - the storage type (see specification)
    //   href - base URL of the storage server
    //
    // Fires:
    //   configured - if wireClient is now fully configured
    //
    setStorageInfo   : function(type, href) { set('storageType', type); set('storageHref', href); },

    // Method: getStorageHref
    //
    // Get base URL of the user's remotestorage.
    getStorageHref   : function() { return get('storageHref') },
    
    // Method: SetBearerToken
    //
    // Set the bearer token for authorization
    //
    // Parameters:
    //   bearerToken - token to use
    //
    // Fires:
    //   configured - if wireClient is now fully configured.
    //
    setBearerToken   : function(bearerToken) { set('bearerToken', bearerToken); },

    // Method: disconnectRemote
    //
    // Clear the wireClient configuration
    disconnectRemote : disconnectRemote,

    // Method: on
    //
    // Install an event handler
    //
    // 
    on               : on,

    // Method: getState
    //
    // Get current state.
    //
    // Possible states are:
    //   anonymous - no information set
    //   authing   - storage's type & href set, but no token received yet
    //   connected - all information present.
    getState         : getState
  };
});
