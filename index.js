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
	homebridge.registerAccessory("homebridge-intesis", "intesis", Intesis);
};

/*
 * Platform code
 * */
function Intesis(log, config) {
	this.log = log;
	this.config = config;
}

Intesis.prototype = {
	accessories: function (callback) {
		var config = this.config;

		this.apiBaseURL = config["apiBaseURL"] || "https://user.intesishome.com/";
		this.apiBaseURL = this.apiBaseURL.lastIndexOf("/") == this.apiBaseURL.length - 1 ? this.apiBaseURL : this.apiBaseURL + "/";
		this.grantType = config["grantType"] || "password";
		this.clientID = config["clientID"];
		this.clientSecret = config["clientSecret"];
		this.username = config["username"];
		this.password = config["password"];
		this.token;
		this.accessories = [];
		this.deviceDictionary = {};
		this.setupAccessories = function (accessories) {
			this.log("Setting up accessories/devices...");
			this.log(JSON.stringify(accessories));
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
	getToken: function (payload, callback) {
		this.log("Obtaining token...");
		callback = callback || function () {};
		request.post({
			"url": this.apiBaseURL + "api.php/oauth2/token",
			"form": payload
		}, callback);
	},
	startWithTokenResult: function (err, httpResponse, body) {
		if (err) {
			this.log("An error occurred obtaining token, homebridge-intesis plugin failed to load.");
			this.log(err);
			return;
		}

		if (body && body.length > 0 && body[0] && body[0].access_token) {
			this.log("Successfully obtained token.");
			this.token = body[0].access_token;
			this.start(this.token, this.instantiateAccessories);
		} else {
			this.log("The response from Intesis while obtaining the token was malformed.  homebridge-intesis plugin failed to load.");
		}
	},
	getConfig: function (token, callback) {
		callback = callback || function () {};
		request({
			"uri": this.apiBaseURL + "api.php/v1/config",
			"method": "GET"
		}, function (err, httpResponse, body) {
			if (err) {
				this.log("An error occurred obtaining config, homebridge-intesis plugin might have failed to load.");
				this.log(err);
				return;
			}

			if (body && body.length > 0 && body[0]) {
				this.log("Successfully obtained config.");
				this.rawConfig = body[0];
				callback(this.rawConfig);
			} else {
				this.log("The response from Intesis while obtaining the config was malformed.");
			}
		});
	},
	instantiateAccessories: function (rawConfig) {
		if (!rawConfig || !rawConfig.devices || rawConfig.devices.length == 0) {
			this.log("Could not instantiate accessories due to malformed config response.");
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

			this.deviceDictionary[name] = new IntesisDevice(this.log, device);
			this.accessories.push(this.deviceDictionary[name]);
			this.log(`Added device with name ${name}.`);
		}

		this.setupAccessories(this.accessories);
	}
}

/*
 * Accessory code
 * */
function IntesisDevice(log, details) {
	this.log = log;
	this.details = details;
}

IntesisDevice.prototype = {
	getState: function (callback) {
		this.log(`getState called and motionDetected: ${this.motionDetected}.`);
		callback(null, this.motionDetected);
	},
	getServices: function () {
		var services = [];

		this.informationService = new Service.AccessoryInformation();
		this.informationService
			.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial);

		services.push(this.informationService);

		this.motionService = new Service.MotionSensor(this.name);
		this.motionService
			.getCharacteristic(Characteristic.MotionDetected)
			.on("get", this.getState.bind(this));

		services.push(this.motionService);
		return services;
	},
	/*
	 * Scenarios:
	 * Start and is currently stopped - trigger immediately
	 * Start and stop is queued - cancel stop if fuse has passed.  This accounts for the lights turning off and triggering the motion.
	 * Stop after delay - this is so the light can stay on for a while after the motion has finished
	*/
	updateState: function (motionDetected) {
		motionDetected = !!motionDetected;

		if (motionDetected == this.motionDetected) {
			this.log("Update state fired but hasn't changed, so didn't update.");
			return;
		}

		if (motionDetected && !this.startFuseActive && this.stopDelayTimeoutID > -1) {
			this.log("A motion start event fired while stop was queued, cleared stop queue.");
			clearTimeout(this.stopDelayTimeoutID);
			return;
		} else if (motionDetected && this.startFuseActive) {
			this.log("A motion start event fired but fuse is running, didn't send start motion event.");
			return;
		}

		if (!motionDetected) {
			this.log("A motion end event fired.  Stop event has now been queued.");
			this.stopDelayTimeoutID = setTimeout(() => {
				this.setState(false);
				this.log("A motion end event set.  Event sent.");
				this.stopDelayTimeoutID = -1;
			}, this.stopDelayMs);
			this.startFuseActive = true;
			this.log("Fuse started.");
			setTimeout(() => {
				this.startFuseActive = false;
				this.log("Fuse cleared.");
			}, this.startAfterStopFuseMs);
			return;
		}

		this.setState(motionDetected);
	},
	setState: function (motionDetected) {
		this.motionDetected = !!motionDetected;
		this.motionService.getCharacteristic(Characteristic.MotionDetected)
			.updateValue(this.motionDetected, null, "updateState");
		this.log(`Motion state updated to ${this.motionDetected}.`);
	}
};