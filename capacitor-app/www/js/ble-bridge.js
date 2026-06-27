/**
 * Web Bluetooth API → Capacitor BLE 桥接脚本
 * 在 Android WebView 中模拟 navigator.bluetooth API
 * 使用 @capacitor-community/bluetooth-le 插件
 */
(function() {
  'use strict';

  // 确保在 Capacitor 环境中运行
  if (typeof Capacitor === 'undefined' || !Capacitor.Plugins || !Capacitor.Plugins.BleClient) {
    console.warn('[BLE Bridge] Capacitor BLE plugin not available');
    return;
  }

  var BleClient = Capacitor.Plugins.BleClient;
  var notificationListeners = {};

  // 短 UUID 转 128 位 UUID
  function to128BitUUID(uuid) {
    if (!uuid) return uuid;
    var s = String(uuid).replace(/[{}]/g, '').replace(/-/g, '');
    if (s.length === 4) {
      return '0000' + s + '-0000-1000-8000-00805f9b34fb';
    } else if (s.length === 8 || s.length === 36) {
      if (s.length === 8) {
        s = s.slice(0,8) + '-' + s.slice(8,12) + '-' + s.slice(12,16) + '-' + s.slice(16,20) + '-' + s.slice(20);
      }
      return s.toLowerCase();
    }
    // 已经 128 位或未知格式，返回原样
    return uuid.toLowerCase();
  }

  // 辅助函数：将 Capacitor BLE 设备转为 Web Bluetooth 设备
  function createBluetoothDevice(capDevice) {
    var deviceId = capDevice.deviceId;
    var gatt = createRemoteGATTServer(deviceId);
    var device = {
      id: deviceId,
      name: capDevice.name || '',
      gatt: gatt,
      addEventListener: function() {},
      removeEventListener: function() {},
      _deviceId: deviceId
    };
    gatt.device = device;
    return device;
  }

  // 创建 RemoteGATTServer
  function createRemoteGATTServer(deviceId) {
    var server = {
      device: null,
      connected: false,
      _deviceId: deviceId,

      connect: function() {
        var self = this;
        return BleClient.connect({ deviceId: deviceId }).then(function() {
          self.connected = true;
          return self;
        });
      },

      disconnect: function() {
        var self = this;
        return BleClient.disconnect({ deviceId: deviceId }).then(function() {
          self.connected = false;
          return self;
        });
      },

      getPrimaryService: function(uuid) {
        var fullUUID = to128BitUUID(
          typeof uuid === 'string' ? uuid : (uuid.uuid || uuid)
        );
        return Promise.resolve(createBluetoothRemoteGATTService(deviceId, fullUUID));
      },

      getPrimaryServices: function(uuid) {
        var fullUUID = uuid ? to128BitUUID(
          typeof uuid === 'string' ? uuid : (uuid.uuid || uuid)
        ) : null;
        var svc = createBluetoothRemoteGATTService(deviceId, fullUUID || '00000000-0000-0000-0000-000000000000');
        return Promise.resolve([svc]);
      }
    };
    return server;
  }

  // 创建 BluetoothRemoteGATTService
  function createBluetoothRemoteGATTService(deviceId, serviceUUID) {
    var fullServiceUUID = to128BitUUID(serviceUUID);
    return {
      uuid: fullServiceUUID,
      isPrimary: true,
      device: null,
      _deviceId: deviceId,
      _serviceUUID: fullServiceUUID,

      getCharacteristic: function(uuid) {
        var fullCharUUID = to128BitUUID(
          typeof uuid === 'string' ? uuid : (uuid.uuid || uuid)
        );
        return Promise.resolve(createBluetoothRemoteGATTCharacteristic(deviceId, fullServiceUUID, fullCharUUID));
      },

      getCharacteristics: function(uuid) {
        var fullCharUUID = uuid ? to128BitUUID(
          typeof uuid === 'string' ? uuid : (uuid.uuid || uuid)
        ) : '00000000-0000-0000-0000-000000000000';
        return Promise.resolve([createBluetoothRemoteGATTCharacteristic(deviceId, fullServiceUUID, fullCharUUID)]);
      },

      getIncludedService: function() {
        return Promise.reject(new Error('Not supported'));
      }
    };
  }

  // 创建 BluetoothRemoteGATTCharacteristic
  function createBluetoothRemoteGATTCharacteristic(deviceId, serviceUUID, characteristicUUID) {
    var fullCharUUID = to128BitUUID(characteristicUUID);
    var fullSvcUUID = to128BitUUID(serviceUUID);

    var listeners = {};
    var char = {
      uuid: fullCharUUID,
      service: null,
      properties: {
        broadcast: false,
        read: true,
        writeWithoutResponse: true,
        write: true,
        notify: true,
        indicate: false,
        authenticatedSignedWrites: false
      },
      value: null,
      _deviceId: deviceId,
      _serviceUUID: fullSvcUUID,
      _characteristicUUID: fullCharUUID,

      readValue: function() {
        var self = this;
        return BleClient.read({
          deviceId: deviceId,
          service: fullSvcUUID,
          characteristic: fullCharUUID
        }).then(function(result) {
          self.value = result.value ? new DataView(result.value.buffer || result.value) : null;
          return self.value;
        });
      },

      writeValue: function(value) {
        var buf = value.buffer || value;
        // 转换为 base64
        var bytes = new Uint8Array(buf);
        var base64 = btoa(String.fromCharCode.apply(null, bytes));
        return BleClient.write({
          deviceId: deviceId,
          service: fullSvcUUID,
          characteristic: fullCharUUID,
          value: base64
        });
      },

      writeValueWithResponse: function(value) {
        return this.writeValue(value);
      },

      writeValueWithoutResponse: function(value) {
        var buf = value.buffer || value;
        var bytes = new Uint8Array(buf);
        var base64 = btoa(String.fromCharCode.apply(null, bytes));
        return BleClient.writeWithoutResponse({
          deviceId: deviceId,
          service: fullSvcUUID,
          characteristic: fullCharUUID,
          value: base64
        });
      },

      startNotifications: function() {
        return BleClient.startNotifications({
          deviceId: deviceId,
          service: fullSvcUUID,
          characteristic: fullCharUUID
        });
      },

      stopNotifications: function() {
        return BleClient.stopNotifications({
          deviceId: deviceId,
          service: fullSvcUUID,
          characteristic: fullCharUUID
        });
      },

      addEventListener: function(type, callback) {
        if (type === 'characteristicvaluechanged') {
          var key = deviceId + '|' + fullCharUUID;
          if (!notificationListeners[key]) {
            notificationListeners[key] = [];
          }
          notificationListeners[key].push(callback);
          // 注意：Capacitor BLE 通知通过全局事件发送，需要在这里设置监听
          if (!listeners._setup) {
            listeners._setup = true;
            // Capacitor BLE 插件使用 addListener 方法
            // 但这不是标准 Web Bluetooth API，需要通过插件监听
          }
          if (!this._setupNotify) {
            this._setupNotify = true;
            // 尝试用 Capacitor 的事件监听
            setupNotificationListener(deviceId, fullSvcUUID, fullCharUUID);
          }
        }
        if (!listeners[type]) {
          listeners[type] = [];
        }
        listeners[type].push(callback);
      },

      removeEventListener: function(type, callback) {
        if (listeners[type]) {
          var idx = listeners[type].indexOf(callback);
          if (idx >= 0) listeners[type].splice(idx, 1);
        }
        if (type === 'characteristicvaluechanged') {
          var key = deviceId + '|' + fullCharUUID;
          if (notificationListeners[key]) {
            var idx2 = notificationListeners[key].indexOf(callback);
            if (idx2 >= 0) notificationListeners[key].splice(idx2, 1);
          }
        }
      },

      dispatchEvent: function(event) {
        var ls = listeners[event.type] || [];
        ls.forEach(function(cb) { cb(event); });
      },

      _listeners: listeners
    };

    return char;
  }

  // 设置 Capacitor BLE 通知监听
  function setupNotificationListener(deviceId, serviceUUID, charUUID) {
    // Capacitor BLE 插件的通知方式是通过全局 listener
    // 需要在 app 级别监听，这里使用 BleClient 的监听机制
    // 注意：这取决于插件版本，可能需要调用不同的 API
    try {
      // 尝试使用 Capacitor 的通用事件监听
      if (Capacitor.Plugins.BleClient.addListener) {
        Capacitor.Plugins.BleClient.addListener('onCharacteristicChanged', function(data) {
          var key = data.deviceId + '|' + (data.characteristic || charUUID);
          var cbs = notificationListeners[key];
          if (cbs && cbs.length) {
            var value = data.value;
            var buffer;
            if (typeof value === 'string') {
              var binaryStr = atob(value);
              var bytes = new Uint8Array(binaryStr.length);
              for (var i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }
              buffer = bytes.buffer;
            } else if (value) {
              buffer = value.buffer || value;
            }
            var event = {
              type: 'characteristicvaluechanged',
              target: {
                value: buffer ? new DataView(buffer) : null
              }
            };
            cbs.forEach(function(cb) { cb(event); });
          }
        });
      }
    } catch(e) {
      console.warn('[BLE Bridge] Could not setup notification listener:', e);
    }
  }

  // 辅助：转换 filter 格式
  function convertFilters(filters) {
    if (!filters || !filters.length) return [];
    return filters.map(function(f) {
      var result = {};
      if (f.services) {
        result.services = f.services.map(function(s) {
          return to128BitUUID(
            typeof s === 'string' ? s : (s.uuid || s)
          );
        });
      }
      if (f.name) result.name = f.name;
      if (f.namePrefix) result.namePrefix = f.namePrefix;
      if (f.manufacturerData) result.manufacturerData = f.manufacturerData;
      if (f.serviceData) result.serviceData = f.serviceData;
      return result;
    });
  }

  // 初始化蓝牙
  var bluetoothInitialized = false;

  // 创建 navigator.bluetooth polyfill
  var bluetoothPolyfill = {
    _initialized: false,

    getAvailability: function() {
      return BleClient.initialize({ androidNeverForLocation: true }).then(function() {
        return BleClient.isEnabled();
      }).then(function(result) {
        return result.value === true;
      }).catch(function() {
        return false;
      });
    },

    requestDevice: function(options) {
      var capOptions = {};

      if (options.filters && options.filters.length) {
        // 取第一个 filter
        var filter = options.filters[0];
        if (filter.services) {
          capOptions.services = filter.services.map(function(s) {
            return to128BitUUID(
              typeof s === 'string' ? s : (s.uuid || s)
            );
          });
        }
        if (filter.name) {
          capOptions.name = filter.name;
        }
        if (filter.namePrefix) {
          capOptions.namePrefix = filter.namePrefix;
        }
        if (filter.manufacturerData) {
          capOptions.manufacturerData = filter.manufacturerData;
        }
      }

      if (options.acceptAllDevices) {
        capOptions.acceptAllDevices = true;
      }

      if (options.optionalServices) {
        capOptions.optionalServices = options.optionalServices.map(function(s) {
          return to128BitUUID(
            typeof s === 'string' ? s : (s.uuid || s)
          );
        });
      }

      if (options.optionalManufacturerData) {
        capOptions.optionalManufacturerData = options.optionalManufacturerData;
      }

      return BleClient.requestDevice(capOptions).then(function(capDevice) {
        return createBluetoothDevice(capDevice);
      });
    },

    requestLEScan: function(options) {
      // 简化实现
      return this.requestDevice(options || {});
    },

    getDevices: function() {
      return BleClient.getDevices({ deviceIds: [] }).then(function(result) {
        return (result.devices || []).map(createBluetoothDevice);
      });
    },

    getPrimaryService: function() {
      return Promise.reject(new Error('Use device.gatt.getPrimaryService()'));
    },

    getPrimaryServices: function() {
      return Promise.reject(new Error('Use device.gatt.getPrimaryServices()'));
    },

    addEventListener: function() {},
    removeEventListener: function() {},
    referringDevice: null
  };

  // 异步初始化并设置 polyfill
  BleClient.initialize({ androidNeverForLocation: true }).then(function() {
    console.log('[BLE Bridge] Bluetooth initialized');
    bluetoothPolyfill._initialized = true;
  }).catch(function(err) {
    console.warn('[BLE Bridge] Bluetooth init failed:', err);
  });

  // 立即设置 navigator.bluetooth
  Object.defineProperty(navigator, 'bluetooth', {
    value: bluetoothPolyfill,
    writable: false,
    configurable: true,
    enumerable: true
  });

  console.log('[BLE Bridge] navigator.bluetooth polyfill installed');
})();
