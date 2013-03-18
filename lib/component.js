// ==========================================
// Copyright 2013 Twitter, Inc
// Licensed under The MIT License
// http://opensource.org/licenses/MIT
// ==========================================

"use strict";

define(

  [
    './advice',
    './utils',
    './compose',
    './registry'
  ],

  function(advice, utils, compose, registry) {

    var functionNameRegEx = /function (.*?)\s?\(/;

    function teardownInstance(instanceInfo){
      instanceInfo.events.slice().forEach(function(event) {
        var args = [event.type];

        event.element && args.unshift(event.element);
        (typeof event.callback == 'function') && args.push(event.callback);

        this.off.apply(this, args);
      }, instanceInfo.instance);
    }


    function teardown() {
      teardownInstance(registry.findInstanceInfo(this));
      registry.teardown.apply(this, arguments);
    }

    //teardown for all instances of this constructor
    function teardownAll() {
      var componentInfo = registry.findComponentInfo(this);

      componentInfo && componentInfo.instances.slice().forEach(function(info) {
        info.instance.teardown();
      });
    }

    function checkSerializable(type, data) {
      try {
        window.postMessage(data, '*');
      } catch(e) {
        console.log('unserializable data for event',type,':',data);
        throw new Error(
          ["The event", type, "on component", this.toString(), "was triggered with non-serializable data"].join(" ")
        );
      }
    }

    //common mixin allocates basic functionality - used by all component prototypes
    //callback context is bound to component
    function withBaseComponent() {

      // delegate trigger, bind and unbind to an element
      // if $element not supplied, use component's node
      // other arguments are passed on
      // event can be either a string specifying the type
      // of the event, or a hash specifying both the type
      // and a default function to be called.
      this.trigger = function() {
        var $element, type, data, event, defaultFn;
        var l = arguments.length;
        var lastIndex = l - 1;
        var args = new Array(l);
        for (var i = 0; i < l; i++) args[i] = arguments[i];
        var lastArg = args[lastIndex];

        if (typeof lastArg != "string" && !(lastArg && lastArg.defaultBehavior)) {
          lastIndex--;
          data = lastArg;
        }

        if (lastIndex == 1) {
          $element = $(args[0]);
          event = args[1];
        } else {
          $element = this.$node;
          event = args[0];
        }

        if (event.defaultBehavior) {
          defaultFn = event.defaultBehavior;
          event = $.Event(event.type);
        }

        type = event.type || event;

        if (window.DEBUG && window.DEBUG.enabled && window.postMessage) {
          checkSerializable.call(this, type, data);
        }

        if (typeof this.attr.eventData === 'object') {
          data = $.extend(true, {}, this.attr.eventData, data);
        }

        $element.trigger((event || type), data);

        if (defaultFn && !event.isDefaultPrevented()) {
          (this[defaultFn] || defaultFn).call(this);
        }

        registry.trigger.apply(this, arguments);

        return $element;
      };

      this.on = function() {
        var $element, type, callback, originalCb;
        var instanceInfo = registry.findInstanceInfo(this);
        var l = arguments.length;
        var lastIndex = l - 1;
        var args = new Array(l);
        for (var i = 0; i < l; i++) args[i] = arguments[i];
        var origin = args[lastIndex];

        if (typeof origin == "object") {
          //delegate callback
          originalCb = utils.delegate(
            this.resolveDelegateRules(origin)
          );
        } else {
          originalCb = origin;
        }

        if (lastIndex == 2) {
          $element = $(args[0]);
          type = args[1];
        } else {
          $element = this.$node;
          type = args[0];
        }

        if (typeof originalCb != 'function' && typeof originalCb != 'object') {
          throw new Error("Unable to bind to '" + type + "' because the given callback is not a function or an object");
        }

        callback = originalCb.bind(this);
        callback.target = originalCb;

        // if the original callback is already branded by jQuery's guid, copy it to the context-bound version
        if (originalCb.guid) {
          callback.guid = originalCb.guid;
        }

        $element.on(type, callback);

        // get jquery's guid from our bound fn, so unbinding will work
        originalCb.guid = callback.guid;

        if (callback) {
          instanceInfo.addBind(registry.eventArgs.apply(this, [type, callback]));
        };

        return callback;
      };

      this.off = function() {
        var $element, type, callback;
        var l = arguments.length;
        var index = l;
        var args = new Array(l);
        for (var i = 0; i < l; i++) args[i] = arguments[i];

        if (typeof args[l - 1] == "function") {
          index = l - 1;
          callback = args[index];
        }

        if (index == 2) {
          $element = $(args[0]);
          type = args[1];
        } else {
          $element = this.$node;
          type = args[0];
        }

        var result = $element.off(type, callback);
        registry.off.apply(this, arguments);
        return result;
      };

      this.resolveDelegateRules = function(ruleInfo) {
        var rules = {};

        Object.keys(ruleInfo).forEach(function(r) {
          if (!r in this.attr) {
            throw new Error('Component "' + this.toString() + '" wants to listen on "' + r + '" but no such attribute was defined.');
          }
          rules[this.attr[r]] = ruleInfo[r];
        }, this);

        return rules;
      };

      this.defaultAttrs = function(defaults) {
        utils.push(this.defaults, defaults, true) || (this.defaults = defaults);
      };

      this.select = function(attributeKey) {
        return this.$node.find(this.attr[attributeKey]);
      };

      this.initialize = $.noop;
      this.teardown = teardown;
    }

    function attachTo(selector/*, options args */) {
      var l = arguments.length;
      var args = new Array(l - 1);
      for (var i = 1; i < l; i++) args[i - 1] = arguments[i];

      if (!selector) {
        throw new Error("Component needs to be attachTo'd a jQuery object, native node or selector string");
      }

      var options = utils.merge(args);

      $(selector).each(function(i, node) {
        new this(node, options);
      }.bind(this));
    }

    // define the constructor for a custom component type
    // takes an unlimited number of mixin functions as arguments
    // typical api call with 3 mixins: define(timeline, withTweetCapability, withScrollCapability);
    function define(/*mixins*/) {
      var l = arguments.length;
      var mixins = new Array(l);
      for (var i = 0; i < l; i++) mixins[i] = arguments[i];

      Component.toString = function() {
        var prettyPrintMixins = mixins.map(function(mixin) {
          if (mixin.name == null) {
            //function name property not supported by this browser, use regex
            var m = mixin.toString().match(functionNameRegEx);
            return (m && m[1]) ? m[1] : "";
          } else {
            return (mixin.name != "withBaseComponent") ? mixin.name : "";
          }
        }).filter(Boolean).join(', ');
        return prettyPrintMixins;
      };

      //'options' is optional hash to be merged with 'defaults' in the component definition
      function Component(node, options) {
        options = options || {};

        if (!node) {
          throw new Error("Component needs a node");
        }

        if (node.jquery) {
          this.node = node[0];
          this.$node = node;
        } else {
          this.node = node;
          this.$node = $(node);
        }

        this.toString = Component.toString;

        //merge defaults with supplied options
        //put options in attr.__proto__ to avoid merge overhead
        var attr = Object.create(options);
        for (var key in this.defaults) {
          if (!options.hasOwnProperty(key)) {
            attr[key] = this.defaults[key];
          }
        }
        this.attr = attr;

        Object.keys(this.defaults || {}).forEach(function(key) {
          if (this.defaults[key] === null && this.attr[key] === null) {
            throw new Error('Required attribute "' + key + '" not specified in attachTo for component "' + this.toString() + '".');
          }
        }, this);

        registry.addInstance(this);
        this.initialize.call(this, options);
      }

      Component.attachTo = attachTo;
      Component.teardownAll = teardownAll;

      // prepend common mixins to supplied list, then mixin all flavors
      mixins.unshift(withBaseComponent, advice.withAdvice);

      compose.mixin(Component.prototype, mixins);

      return Component;
    }

    define.teardownAll = function() {
      registry.components.slice().forEach(function(c) {
        c.component.teardownAll();
      });
      registry.reset();
    };

    return define;
  }
);
