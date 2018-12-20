/**
 * MIT License
 *
 * Copyright (c) 2018 Phillip Moon
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 **/
var Service, Characteristic;
const request = require("request");
const url = require("url");

module.exports = function (homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerPlatform("homebridge-intesis", "intesis", Intesis);
};

/*
 * Platform code
 * */
function Intesis(log, config) {
	this.log = log;
	this.config = config;
	this.parseJSON = function (stringPayload) {
		try {
			return JSON.parse(stringPayload);
		} catch (error) { }

		return false;
	};
}

Intesis.prototype = {
	accessories: function (callback) {
		var config = this.config;

		this.apiAuthURLSuffix = config["apiAuthURLSuffix"] || "oauth2/token";
		this.apiAuthURLSuffix = this.apiAuthURLSuffix[0] == "/" ? this.apiAuthURLSuffix.substring(1) : this.apiAuthURLSuffix;
		this.apiBaseURL = config["apiBaseURL"] || "https://user.intesishome.com/";
		this.apiBaseURL = this.apiBaseURL.lastIndexOf("/") == this.apiBaseURL.length - 1 ? this.apiBaseURL : this.apiBaseURL + "/";
		this.grantType = config["grantType"] || "password";
		this.clientID = config["clientID"];
		this.clientSecret = config["clientSecret"];
		this.username = config["username"];
		this.password = config["password"];
		this.configCacheSeconds = config["configCacheSeconds"] || 30;
		this.token;
		this.refreshToken;
		this.accessories = [];
		this.deviceDictionary = {};
		this.tokenRefreshTimeoutID = -1;
		this.refreshConfigCallbackQueue = [];
		this.callbackRefreshConfigQueue = (function () {
			var item = this.refreshConfigCallbackQueue.pop();

			this.log("Calling all the callbacks in queue for post refresh config.");

			while (item) {
				if (typeof item === "function") {
					item();
				}

				item = this.refreshConfigCallbackQueue.pop();
			}

			this.log("Done calling all the callbacks in queue for post refresh config.");
		}).bind(this);
		this.setupAccessories = function (accessories) {
			this.log("Setting up accessories/devices...");
			this.log(accessories);
			callback(accessories);
		};
		this.getToken({
			"grant_type": this.grantType,
			"client_id": this.clientID,
			"client_secret": this.clientSecret,
			"username": this.username,
			"password": this.password
		}, this.startWithTokenResult);
	},
	getRefreshToken: function () {
		this.log("Refreshing token...");
		request.post({
			"url": this.apiBaseURL + this.apiAuthURLSuffix,
			"form": {
				"grant_type": "refresh_token",
				"client_id": this.clientID,
				"client_secret": this.clientSecret,
				"refresh_token": this.refreshToken
			}
		}, (function (a, b, c) { this.getRefreshToken_callback(a, b, c); }).bind(this));
	},
	getRefreshToken_callback: function (err, httpResponse, body) {
		if (err || httpResponse.statusCode != 200) {
			this.log("An error occurred obtaining token with refresh token.");
			this.log(err);
			return;
		}

		body = this.parseJSON(body);

		if (body && body.access_token) {
			this.log("Successfully obtained token.");
			this.token = body.access_token;
			this.tokenRefreshTimeoutID = setTimeout((function () { this.getRefreshToken(); }).bind(this), (body.expires_in - 30) * 1000);
		} else {
			this.log("The response from Intesis while obtaining the token (with refresh token) was malformed.");
		}
	},
	getToken: function (payload, callback) {
		this.log("Obtaining token...");
		callback = (callback || function () {}).bind(this);
		request.post({
			"url": this.apiBaseURL + this.apiAuthURLSuffix,
			"form": payload
		}, callback);
	},
	startWithTokenResult: function (err, httpResponse, body) {
		if (err || httpResponse.statusCode != 200) {
			this.log("An error occurred obtaining token, homebridge-intesis plugin failed to load.");
			this.log(err);
			return;
		}

		body = this.parseJSON(body);

		if (body && body.access_token) {
			this.log("Successfully obtained token.");
			this.token = body.access_token;

			if (body.refresh_token && body.expires_in) {
				this.refreshToken = body.refresh_token;
				this.tokenRefreshTimeoutID = setTimeout((function () { this.getRefreshToken(); }).bind(this), (body.expires_in - 30) * 1000);
			} else {
				this.log("No refresh token was given, failure imminent in approximately 60 minutes.");
			}
			
			this.getConfig(this.token, this.instantiateAccessories);
		} else {
			this.log("The response from Intesis while obtaining the token was malformed.  homebridge-intesis plugin failed to load.");
		}
	},
	getConfig: function (token, callback) {
		callback = (callback || function () {}).bind(this);
		request({
			"uri": this.apiBaseURL + "api.php/v1/config",
			"method": "GET",
			"headers": {
				"Authorization": "Bearer " + token
			}
		}, function (err, httpResponse, body) {
			if (err || httpResponse.statusCode != 200) {
				this.log("An error occurred obtaining config, homebridge-intesis plugin might have failed to load.");
				this.log(err);
				return;
			}

			body = this.parseJSON(body);

			if (body && body.length > 0 && body[0]) {
				this.log("Successfully obtained config.");
				this.lastConfigFetch = new Date().getTime();
				callback(body[0]);
			} else {
				this.log("The response from Intesis while obtaining the config was malformed.");
			}
		}.bind(this));
	},
	refreshConfig: function (callback) {
		this.log("Attempting to refresh config.");
		callback = callback || function () {};

		if (this.lastConfigFetch && (new Date().getTime() - this.lastConfigFetch) / 1000 <= this.configCacheSeconds) {
			this.log(`Config data isn't older than the configured cache time (${this.configCacheSeconds}s), not refreshing.`);
			callback();
			return;
		}

		this.refreshConfigCallbackQueue.push(callback);

		if (this.refreshConfigInProgress) {
			this.log("Refresh config in progress, adding callback to queue.");
			return;
		}

		this.refreshConfigInProgress = true;
		this.getConfig(this.token, function (rawConfig) {
			this.log("Successfully refreshed config data.");
			var devices = rawConfig.devices;

			for (var i = 0, l = devices.length; i < l; i++) {
				var device = devices[i];
				var name = device.name;

				if (!name || !this.deviceDictionary[name]) {
					continue;
				}

				this.deviceDictionary[name].updateData(device);
			}

			this.refreshConfigInProgress = false;
			this.callbackRefreshConfigQueue();
		});
	},
	instantiateAccessories: function (rawConfig) {
		if (!rawConfig || !rawConfig.devices || rawConfig.devices.length == 0) {
			this.log("Could not instantiate accessories due to malformed config, or no devices in response.");
			return;
		}

		var devices = rawConfig.devices;

		for (var i = 0, l = devices.length; i < l; i++) {
			var device = devices[i];
			var name = device.name;

			if (!name) {
				this.log("The following device didn't have a name, so did not add.");
				this.log(JSON.stringify(device));
				continue;
			}

			this.deviceDictionary[name] = new IntesisDevice(this.log, device, this);
			this.accessories.push(this.deviceDictionary[name]);
			this.log(`Added device with name ${name}.`);
		}

		this.setupAccessories(this.accessories);
	},
	setValue: function (deviceID, serviceID, value, callback) {
		if (!deviceID) {
			callback("No deviceID supplied.");
			return;
		}

		if (!serviceID) {
			callback("No serviceID supplied.");
			return;
		}

		callback = callback || function () {};
		this.log("Making setValue request", { "token": this.token , "device_id": deviceID, "service_id": serviceID, "value": value });
		request({
			"uri": this.apiBaseURL + "api.php/v2/set",
			"method": "POST",
			"headers": {
				"Authorization": "Bearer " + this.token,
				"Content-Type": "application/json"
			},
			"body": JSON.stringify([{
				"device_id": deviceID,
				"service_id": serviceID,
				"value": value
			}])
		}, function (err, httpResponse, body) {
			this.log("setValue response error", err);
			this.log("setValue response status code", httpResponse.statusCode);
			this.log("setValue body", body);

			if (err || httpResponse.statusCode != 200) {
				this.log(`An error occurred setting value [${value}] for the device [${deviceID}] and service [${serviceID}].`);
				this.log(err);
				callback(err);
				return;
			}

			body = this.parseJSON(body);

			if (body && body.length > 0 && body[0] && body[0].length == 3) {
				callback(null, body[0][2]);
			} else {
				err = `Set value [${value}] for the device [${deviceID}] and service [${serviceID}], but bad response so probably didn't set the value.`;
				this.log(err);
				callback(err);
			}
		}.bind(this));
	}
}

/*
 * Accessory code
 * */
function IntesisDevice(log, details, platform) {
	this.dataMap = {
		"fanSpeed": {
			"intesis": ["" , "position-one", "position-two", "position-three", "position-four"],
			"homekit": {
				"position-one": 1,
				"position-two": 2,
				"position-three": 3,
				"position-four": 4
			}
		},
		"userMode": {
			"intesis": function (homekitValue) {
				var intesisMode = "auto";

				switch (homekitValue) {
					case Characteristic.TargetHeaterCoolerState.HEAT:
						intesisMode = "heat";
						break;
					case Characteristic.TargetHeaterCoolerState.COOL:
						intesisMode = "cool";
						break;
					case Characteristic.TargetHeaterCoolerState.AUTO:
					default:
						intesisMode = "auto";
						break;
				}

				return intesisMode;
			},
			"homekit": {
				"heat": Characteristic.TargetHeaterCoolerState.HEAT,
				"cool": Characteristic.TargetHeaterCoolerState.COOL,
				"auto": Characteristic.TargetHeaterCoolerState.AUTO,
				"dry": Characteristic.TargetHeaterCoolerState.AUTO,
				"fan": Characteristic.TargetHeaterCoolerState.AUTO
			}
		}
	};
	this.log = log;
	this.details = details;
	this.platform = platform;
	this.name = details.name;
	this.heaterCoolerService = new Service.HeaterCooler(details.name);
	this.accessoryInfoService = new Service.AccessoryInformation();
	this.accessoryInfoService
		.setCharacteristic(Characteristic.Manufacturer, "Intesis")
		.setCharacteristic(Characteristic.Model, details.name)
		.setCharacteristic(Characteristic.SerialNumber, details.device_id);
	this.services = [this.heaterCoolerService, this.accessoryInfoService];
	this.setup(this.details);
}

IntesisDevice.prototype = {
	setup: function (details) {
		var services = details.services;
		var deviceID = details.device_id;

		for (var serviceName in services) {
			var service = services[serviceName];

			if (Array.isArray(service)) {
				continue; //LOOKS LIKE WHEN IT'S AN ARRAY IT'S NOT AN ACTUAL SERVICE?
			}

			this.addService(service, deviceID);
		}
	},
	getServices: function () {
		return this.services;
	},
	updateData: function (newDetails) {
		if (!newDetails) {
			return;
		}

		this.details = newDetails;
	},
	addService: function (service, deviceID) {
		var serviceID = service.service_id.toLowerCase();

		switch (serviceID) {
			case "com.intesishome.power":
				this.heaterCoolerService
					.getCharacteristic(Characteristic.Active)
					.on("get", function (callback) {
						this.platform.refreshConfig(function () {
							this.log("com.intesishome.power GET", this.details.services["com.intesishome.power"]);
							callback(null, this.details.services["com.intesishome.power"].value ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
						}.bind(this));
					}.bind(this))
					.on("set", function (value, callback) {
						this.log("com.intesishome.power SET", value);
						this.platform.setValue(deviceID, "com.intesishome.power", !!value, function (error, value) {
							if (!error) {
								this.details.services["com.intesishome.power"].value = value;
							}

							callback(error, value ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
						}.bind(this));
					}.bind(this));
				break;
			case "com.intesishome.user-mode":
				this.heaterCoolerService
					.getCharacteristic(Characteristic.TargetHeaterCoolerState)
					.on("get", function (callback) {
						this.platform.refreshConfig(function () {
							this.log("com.intesishome.user-mode GET", this.details.services["com.intesishome.user-mode"]);
							callback(null, this.dataMap.userMode.homekit[this.details.services["com.intesishome.user-mode"].value.toLowerCase()]);
						}.bind(this));
					}.bind(this))
					.on("set", function(value, callback) {
						this.log("com.intesishome.user-mode SET", value);
						this.platform.setValue(deviceID, "com.intesishome.user-mode", this.dataMap.userMode.intesis(value), function (error, value) {
							if (!error) {
								this.details.services["com.intesishome.user-mode"].value = value;
							}

							callback(error, this.dataMap.userMode.intesis(value));
						}.bind(this));
					}.bind(this));
				break;
			case "com.intesishome.fan-speed":
				this.heaterCoolerService
					.addCharacteristic(Characteristic.RotationSpeed)
					.setProps({
						"maxValue": 4,
						"minValue": 0,
						"minStep": 1
					})
					.on("get", function (callback) {
						this.platform.refreshConfig(function () {
							this.log("com.intesishome.fan-speed GET", this.details.services["com.intesishome.fan-speed"]);
							callback(null, this.dataMap.fanSpeed.homekit[this.details.services["com.intesishome.fan-speed"].value]);
						}.bind(this));
					}.bind(this))
					.on("set", function (value, callback) {
						this.log("com.intesishome.fan-speed SET", value);
						this.platform.setValue(deviceID, "com.intesishome.fan-speed", this.dataMap.fanSpeed.intesis[value], function (error, value) {
							if (!error) {
								this.details.services["com.intesishome.fan-speed"].value = value;
							}

							callback(error, this.dataMap.fanSpeed.intesis[value]);
						}.bind(this));
					}.bind(this));
				break;
			case "com.intesishome.setpoint-temp":
				var maxTemp = 35;
				var minTemp = 10;
				var step = 1;

				if (this.details.services["com.intesishome.setpoint-temp"]) {
					if (this.details.services["com.intesishome.setpoint-temp"].max_value) {
						maxTemp = this.details.services["com.intesishome.setpoint-temp"].max_value;
					}

					if (this.details.services["com.intesishome.setpoint-temp"].min_value) {
						minTemp = this.details.services["com.intesishome.setpoint-temp"].min_value;
					}

					if (this.details.services["com.intesishome.setpoint-temp"].step) {
						step = this.details.services["com.intesishome.setpoint-temp"].step;
					}
				}

				this.heaterCoolerService
					.addCharacteristic(Characteristic.CoolingThresholdTemperature)
					.setProps({
						"maxValue": maxTemp,
						"minValue": minTemp,
						"minStep": step
					})
					.on("get", function (callback) {
						this.platform.refreshConfig(function () {
							this.log("com.intesishome.setpoint-temp GET", this.details.services["com.intesishome.setpoint-temp"]);
							callback(null, this.details.services["com.intesishome.setpoint-temp"].value);
						}.bind(this));
					}.bind(this))
					.on("set", function (value, callback) {
						this.log("com.intesishome.setpoint-temp SET", value);
						this.platform.setValue(deviceID, "com.intesishome.setpoint-temp", value, function (error, value) {
							if (!error) {
								this.details.services["com.intesishome.setpoint-temp"].value = value;
							}

							callback(error, value);
						}.bind(this));
					}.bind(this))
					.updateValue(this.targetTemperature);

				this.heaterCoolerService
					.addCharacteristic(Characteristic.HeatingThresholdTemperature)
					.setProps({
						"maxValue": maxTemp,
						"minValue": minTemp,
						"minStep": step
					})
					.on("get", function (callback) {
						this.platform.refreshConfig(function () {
							this.log("com.intesishome.setpoint-temp GET", this.details.services["com.intesishome.setpoint-temp"]);
							callback(null, this.details.services["com.intesishome.setpoint-temp"].value);
						}.bind(this));
					}.bind(this))
					.on("set", function (value, callback) {
						this.log("com.intesishome.setpoint-temp SET", value);
						this.platform.setValue(deviceID, "com.intesishome.setpoint-temp", value, function (error, value) {
							if (!error) {
								this.details.services["com.intesishome.setpoint-temp"].value = value;
							}

							callback(error, value);
						}.bind(this));
					}.bind(this))
					.updateValue(this.targetTemperature);
				break;
			case "com.intesishome.current-temp":
				this.heaterCoolerService
					.getCharacteristic(Characteristic.CurrentTemperature)
					.on("get", function (callback) {
						this.platform.refreshConfig(function () {
							this.log("com.intesishome.current-temp GET", this.details.services["com.intesishome.current-temp"]);
							callback(null, this.details.services["com.intesishome.current-temp"].value);
						}.bind(this));
					}.bind(this))
					.updateValue(this.details.services["com.intesishome.current-temp"].value);
				break;
		}
	}
};