/*global Buffer */
/*global window */
/*global console */
/*global Uint8Array */
/*global setTimeout */
/*global localStorage */
/*global ArrayBuffer */

define([], function() {

  "use strict";

  // Namespace: util
  //
  // Utility functions. Mainly logging.
  //

  var loggers = {}, silentLogger = {};

  var knownLoggers = [];

  var logFn = null;

  var logLevels = {
    error: true,
    info: true,
    debug: false
  };

  var atob, btoa;

  // btoa / atob for nodejs implemented here, so util/platform don't form
  // a circular dependency.
  if(typeof(window) === 'undefined') {
    atob = function(str) {
      var buffer = str instanceof Buffer ? str : new Buffer(str, 'base64');
      return buffer.toString('binary');
    };
    btoa = function(str) {
      var buffer = str instanceof Buffer ? str : new Buffer(str, 'binary');
      return buffer.toString('base64');
    };
  } else {
    atob = window.atob;
    btoa = window.btoa;
  }

  var Promise = function() {
    this.result = undefined;
    this.success = undefined;
    this.handlers = {};
    this.__defineSetter__('onsuccess', function(fulfilledHandler) {
      if(typeof(fulfilledHandler) !== 'function') {
        throw "Success callback must be a function!";
      }
      this.handlers.fulfilled = fulfilledHandler;
      if(! this.nextPromise) {
        this.nextPromise = new Promise();
      }
    });
    this.__defineSetter__('onerror', function(failedHandler) {
      if(typeof(failedHandler) !== 'function') {
        throw "Error callback must be a function!";
      }
      this.handlers.failed = failedHandler;
      if(! this.nextPromise) {
        this.nextPromise = new Promise();
      }
    });
  };

  Promise.prototype = {
    fulfill: function() {
      if(typeof(this.success) !== 'undefined') {
        throw new Error("Can't fail promise, already resolved as: " +
                        (this.success ? 'fulfilled' : 'failed'));
      }
      this.result = util.toArray(arguments);
      this.success = true;
      if(! this.handlers.fulfilled) {
        return;
      }
      var nextResult;
      try {
        nextResult = this.handlers.fulfilled.apply(this, this.result);
      } catch(exc) {
        if(this.nextPromise) {
          this.nextPromise.fail(exc);
        } else {
          console.error("Uncaught exception: ", exc, exc.getStack());
        }
        return;
      }
      var nextPromise = this.nextPromise;
      if(nextPromise) {
        if(nextResult && typeof(nextResult.then) === 'function') {
          // chain our promise after this one.
          nextResult.then(function() {
            nextPromise.fulfill.apply(nextPromise, arguments);
          }, function() {
            nextPromise.fail.apply(nextPromise, arguments);
          });
        } else {
          nextPromise.fulfill(nextResult);
        }
      }
    },

    fail: function() {
      if(typeof(this.success) !== 'undefined') {
        throw new Error("Can't fail promise, already resolved as: " +
                        (this.success ? 'fulfilled' : 'failed'));
      }
      this.result = util.toArray(arguments);
      this.success = false;
      if(this.handlers.failed) {
        this.handlers.failed.apply(this, this.result);
      } else if(this.nextPromise) {
        this.nextPromise.fail.apply(this.nextPromise, this.result);
      } else {
        console.error("Uncaught error: ", this.result, (this.result[0] && this.result[0].stack));
      }
    },

    fulfillLater: function() {
      var args = util.toArray(arguments);
      util.nextTick(function() {
        this.fulfill.apply(this, args);
      }.bind(this));
      return this;
    },

    failLater: function() {
      var args = util.toArray(arguments);
      util.nextTick(function() {
        this.fail.apply(this, args);
      }.bind(this));
      return this;
    },

    then: function(fulfilledHandler, errorHandler) {
      this.handlers.fulfilled = fulfilledHandler;
      this.handlers.failed = errorHandler;
      this.nextPromise = new Promise();
      return this.nextPromise;
    },

    get: function() {
      var propertyNames = util.toArray(arguments);
      return this.then(function(result) {
        var promise = new Promise();
        var values = [];
        if(typeof(result) !== 'object') {
          promise.failLater(new Error(
            "Can't get properties of non-object (properties: " + 
              propertyNames.join(', ') + ')'
          ));
        } else {
          propertyNames.forEach(function(propertyName) {
            values.push(result[propertyName]);
          });
          promise.fulfillLater.apply(promise, values);
        }
        return promise;
      });
    },

    call: function(methodName) {
      var args = Array.prototype.slice.call(arguments, 1);
      return this.then(function(result) {
        return result[methodName].apply(result, args);
      });
    }
  };


  var util = {

    bufferToRaw: function(buffer) {
      var view = new Uint8Array(buffer);
      var nData = view.length;
      var rawData = '';
      for(var i=0;i<nData;i++) {
        rawData += String.fromCharCode(view[i]);
      }
      return rawData;
    },

    rawToBuffer: function(rawData) {
      var nData = rawData.length;
      var buffer = new ArrayBuffer(nData);
      var view = new Uint8Array(buffer);

      for(var i=0;i<nData;i++) {
        view[i] = rawData.charCodeAt(i);
      }
      return buffer;
    },

    encodeBinary: function(buffer) {
      return btoa(this.bufferToRaw(buffer));
    },

    decodeBinary: function(data) {
      return this.rawToBuffer(atob(data));
    },

    // Method: toArray
    // Convert something into an Array.
    // Example:
    // > function squareAll() {
    // >   return util.toArray(arguments).map(function(arg) {
    // >     return Math.pow(arg, 2);
    // >   });
    // > }
    toArray: function(arrayLike) {
      return Array.prototype.slice.call(arrayLike);
    },

    nextTick: function(action) {
      setTimeout(action, 0);
    },

    // Method: isDir
    // Convenience method to check if given path is a directory.
    isDir: function(path) {
      return path.substr(-1) == '/';
    },

    pathParts: function(path) {
      var parts = ['/'];
      var md;
      while((md = path.match(/^(.*?)([^\/]+\/?)$/))) {
        parts.unshift(md[2]);
        path = md[1];
      }
      return parts;
    },

    extend: function(a, b) {
      for(var key in b) {
        a[key] = b[key];
      }
      return a;
    },

    // Method: containingDir
    // Calculate the parent path of the given path, by stripping the last part.
    //
    // Parameters:
    //   path - any path, absolute or relative.
    //
    // Returns:
    //   the parent path or *null*, if the given path is a root ("" or "/")
    //
    containingDir: function(path) {
      var dir = path.replace(/[^\/]+\/?$/, '');
      return dir == path ? null : dir;
    },

    baseName: function(path) {
      var parts = path.split('/');
      if(util.isDir(path)) {
        return parts[parts.length-2]+'/';
      } else {
        return parts[parts.length-1];
      }
    },

    bindAll: function(object) {
      for(var key in object) {
        if(typeof(object[key]) === 'function') {
          object[key] = this.bind(object[key], object);
        }
      }
      return object;
    },

    curry: function(f) {
      if(typeof(f) !== 'function') {
        throw "Can only curry functions!";
      }
      var _a = Array.prototype.slice.call(arguments, 1);
      return function() {
        var a = util.toArray(arguments);
        for(var i=(_a.length-1);i>=0;i--) {
          a.unshift(_a[i]);
        }
        return f.apply(this, a);
      };
    },

    rcurry: function(f) {
      if(typeof(f) !== 'function') {
        throw "Can only curry functions!";
      }
      var _a = Array.prototype.slice.call(arguments, 1);
      return function() {
        var a = util.toArray(arguments);
        _a.forEach(function(item) {
          a.push(item);
        });
        return f.apply(this, a);
      };
    },

    bind: function(callback, context) {
      if(context) {
        return function() { return callback.apply(context, arguments); };
      } else {
        return callback;
      }
    },

    deprecate: function(methodName, replacement) {
      console.log('WARNING: ' + methodName + ' is deprecated, use ' + replacement + ' instead');
    },

    highestAccess: function(a, b) {
      return (a == 'rw' || b == 'rw') ? 'rw' : (a == 'r' || b == 'r') ? 'r' : null;
    },

    // Method: getEventEmitter
    //
    // Create a new EventEmitter object and return it.
    //
    // It gets all valid events as it's arguments.
    //
    // Example:
    // (start code)
    // var events = util.getEventEmitter('change', 'error');
    // events.on('error', function(what) { alert('something happens: ' + what); });
    // events.emit('error', 'fired!');
    // (end code)
    //
    getEventEmitter: function() {
      var eventNames = util.toArray(arguments);

      function setupHandlers() {
        var handlers = {};
        eventNames.forEach(function(name) {
          handlers[name] = [];
        });
        return handlers;
      }

      return this.bindAll({

        _handlers: setupHandlers(),

        emit: function(eventName) {
          var handlerArgs = Array.prototype.slice.call(arguments, 1);
          // console.log("EMIT", eventName, handlerArgs);
          if(! this._handlers[eventName]) {
            throw "Unknown event: " + eventName;
          }
          this._handlers[eventName].forEach(function(handler) {
            if(handler) {
              handler.apply(null, handlerArgs);
            }
          });
        },

        once: function(eventName, handler) {
          if(! this._handlers[eventName]) {
            throw "Unknown event: " + eventName;
          }
          var i = this._handlers[eventName].length;
          if(typeof(handler) !== 'function') {
            throw "Expected function as handler, got: " + typeof(handler);
          }
          this.on(eventName, function() {
            delete this._handlers[eventName][i];
            handler.apply(this, arguments);
          }.bind(this));
        },

        on: function(eventName, handler) {
          if(! this._handlers[eventName]) {
            throw "Unknown event: " + eventName;
          }
          if(typeof(handler) !== 'function') {
            throw "Expected function as handler, got: " + typeof(handler);
          }
          this._handlers[eventName].push(handler);
        },

        reset: function() {
          this._handlers = setupHandlers();
        }

      });

    },

    // Method: getLogger
    //
    // Get a logger with a given name.
    // Usually this only happens once per file.
    //
    // Parameters:
    //   name - name of the logger. usually the name of the file this method
    //          is called from.
    //
    // Returns:
    //   A logger object
    //
    getLogger: function(name) {

      if(! loggers[name]) {
        knownLoggers.push(name);
        loggers[name] = {

          info: function() {
            this.log('info', util.toArray(arguments));
          },

          debug: function() {
            this.log('debug', util.toArray(arguments), 'debug');
          },

          error: function() {
            this.log('error', util.toArray(arguments), 'error');
          },

          log: function(level, args, type) {
            if(silentLogger[name] || logLevels[level] === false) {
              return;
            }
            if(logFn) {
              return logFn(name, level, args);
            }

            if(! type) {
              type = 'log';
            }

            args.unshift("[" + name.toUpperCase() + "] -- " + level + " ");

            (console[type] || console.log).apply(console, args);
          }
        };
      }

      return loggers[name];
    },

    // Method: setLogFunction
    //
    // Override the default logger with a custom function.
    // After the remotestorage will no longer log to the browser console, but
    // instead pass each logger call to the provided function.
    //
    // Log function parameters:
    //   name  - Name of the logger.
    //   level - loglevel, one of 'info', 'debug', 'error'
    //   args  - Array of arguments passed to the logger. can be anything.
    setLogFunction: function(logFunction) {
      logFn = logFunction;
    },

    // Method: silenceLogger
    // Silence all given loggers.
    //
    // So, if you're not interested in seeing all the synchronization logs, you could do:
    // > remoteStorage.util.silenceLogger('sync');
    //
    silenceLogger: function() {
      var names = util.toArray(arguments);
      var numNames = names.length;
      for(var i=0;i<numNames;i++) {
        silentLogger[ names[i] ] = true;
      }
    },

    // Method: silenceLogger
    // Unsilence all given loggers.
    // The opposite of <silenceLogger>
    unsilenceLogger: function() {
      var names = util.toArray(arguments);
      var numNames = names.length;
      for(var i=0;i<numNames;i++) {
        delete silentLogger[ names[i] ];
      }
    },

    // Method: silenceAllLoggers
    // silence all known loggers
    silenceAllLoggers: function() {
      this.silenceLogger.apply(this, knownLoggers);
    },

    // Method: unsilenceAllLoggers
    // opposite of <silenceAllLoggers>
    unsilenceAllLoggers: function() {
      this.unsilenceLogger.apply(this, knownLoggers);
    },

    // Method: setLogLevel
    // Set the maximum log level to use. Messages with
    // a lower log level won't be displayed.
    //
    // Log levels are:
    //   > debug < info < error
    //
    // Example:
    //   (start code)
    //   util.setLogLevel('info');
    //   var logger = util.getLogger('my-logger');
    //   logger.error("something went wrong"); // displayed
    //   logger.info("hey, how's it going?");  // displayed
    //   logger.debug("foo bar baz"); // not displayed
    //   (end code)
    setLogLevel: function(level) {
      if(level == 'debug') {
        logLevels.debug = true;
        logLevels.info = true;
      } else if(level == 'info') {
        logLevels.info = true;
        logLevels.debug = false;
      } else if(level == 'error') {
        logLevels.info = false;
        logLevels.debug = false;
      } else {
        throw "Unknown log level: " + level;
      }
    },

    // Method: grepLocalStorage
    // Find a list of keys that match a given pattern.
    //
    // Iterates over all localStorage keys and calls given 'iter'
    // for each key that matches given 'pattern'.
    //
    // The iter receives the matching key as it's only argument.
    grepLocalStorage: function(pattern, iter) {
      var numLocalStorage = localStorage.length;
      var keys = [];
      for(var i=0;i<numLocalStorage;i++) {
        var key = localStorage.key(i);
        if(pattern.test(key)) {
          keys.push(key);
        }
      }
      keys.forEach(iter);
    },

    getPromise: function() {
      return new Promise();
    },

    isPromise: function(object) {
      return typeof(object) === 'object' && typeof(object.then) === 'function';
    },

    makePromise: function(futureCallback) {
      var promise = new Promise();
      util.nextTick(function() {
        try {
          var result = futureCallback(promise);
          if(result && result.then && typeof(result.then) === 'function') {
            result.then(
              promise.fulfill.bind(promise),
              promise.fail.bind(promise)
            );
          }
        } catch(exc) {
          promise.fail(exc);
        }
      });
      return promise;
    },

    asyncGroup: function() {
      var functions = util.toArray(arguments);
      var results = [];
      var todo = functions.length;
      var errors = [];
      return util.makePromise(function(promise) {
        if(functions.length === 0) {
          return promise.fulfill([], []);
        }
        function finishOne(result, index) {
          results[index] = result;
          todo--;
          if(todo === 0) {
            promise.fulfill(results, errors);
          }
        }
        function failOne(error) {
          console.error("asyncGroup part failed: ", error.stack || error);
          errors.push(error);
          finishOne();
        }
        functions.forEach(function(fun, index) {
          if(typeof(fun) !== 'function') {
            throw new Error("asyncGroup got non-function: " + fun);
          }
          var _result = fun();
          if(_result && _result.then && typeof(_result.then) === 'function') {
            _result.then(function(result) {
              finishOne(result, index);
            }, failOne);
          } else {
            finishOne(_result, index);
          }
        });
      });
    },

    asyncEach: function(array, iterator) {
      return util.makePromise(function(promise) {
        util.asyncGroup.apply(
          util, array.map(function(element, index) {
            return util.curry(iterator, element, index);
          })
        ).then(function(results, errors) {
          promise.fulfill(array, errors);
        });
      });
    },

    asyncMap: function(array, mapper) {
      return util.asyncGroup.apply(
        util, array.map(function(element) {
          return util.curry(mapper, element);
        })
      );
    },
    

    asyncSelect: function(array, testFunction) {
      var a = [];
      return util.asyncEach(array, function(element) {
        return testFunction(element).then(function(result) {
          if(result) {
            a.push(element);
          }
        });
      }).then(function() {
        return a;
      });
    },

    getSettingStore: function(prefix) {
      function makeKey(key) {
        return prefix + ':' + key;
      }
      return {
        get: function(key) {
          var data = localStorage.getItem(makeKey(key));
          try { data = JSON.parse(data); } catch(e) {}
          return data;
        },
        set: function(key, value) {
          if(typeof(value) !== 'string') {
            value = JSON.stringify(value);
          }
          return localStorage.setItem(makeKey(key), value);
        },
        remove: function(key) {
          return localStorage.removeItem(makeKey(key));
        },
        clear: function() {
          util.grepLocalStorage(new RegExp('^' + prefix), function(key) {
            localStorage.removeItem(key);
          });
        }
      }
    }
  };

  // Class: Logger
  //
  // Method: info
  // Log to loglevel "info".
  //
  // Method: debug
  // Log to loglevel "debug".
  // Will use the browser's debug logging facility, if available.
  //
  // Method: debug
  // Log to loglevel "error".
  // Will use the browser's error logging facility, if available.
  //

  // Class: EventEmitter
  //
  // Method: emit
  //
  // Fire an event
  //
  // Parameters:
  //   eventName - name of the event. Must have been passed to getEventEmitter.
  //   *rest     - arguments passed to the handler.
  //
  // Method: on
  //
  // Install an event handler
  //
  // Parameters:
  //   eventName - name of the event. Must have been passed to getEventEmitter.
  //   handler   - handler to call when an event is emitted.
  //

  return util;
});

