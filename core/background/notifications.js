'use strict';

define([
	'wrappers/chrome',
	'services/background-ga'
], function(chrome, GA) {
	const SIGN_IN_ERROR_MESSAGE = 'Unable to log in to Last.fm. Please try later';

	const DEFAULT_OPTIONS_VALUES = {
		type: 'basic',
		iconUrl: 'icons/icon128.png',
	};

	/**
	 * Map of click listeners indexed by notification IDs.
	 * @type {Object}
	 */
	var clickListeners = {};

	/**
	 * Check for permissions and existence of Notifications API
	 * (to be safe to run on minor browsers like Opera).
	 * @return {Boolean} True if notifications are available
	 */
	function isAvailable() {
		return chrome.notifications !== undefined;
	}

	/**
	 * Check if notifications are allowed by user.
	 * @return {Boolean} True if notifications are allowed by user
	 */
	function isAllowed() {
		return localStorage.useNotifications === '1';
	}

	/**
	 * Set up listener for click on given notification.
	 * All clicks are handled internally and transparently passed to listeners, if any.
	 * Setting multiple listeners for single notification is not supported,
	 * the last set listener will overwrite any previous.
	 *
	 * @param {String} notificationId Notification ID
	 * @param {function} callback Function that will be called on notification click
	 */
	function addOnClickedListener(notificationId, callback) {
		clickListeners[notificationId] = callback;
	}

	/**
	 * Remove onClicked listener for given notification.
	 * @param {String} notificationId Notification ID
	 */
	function removeOnClickedListener(notificationId) {
		if (clickListeners[notificationId]) {
			delete clickListeners[notificationId];
		}
	}

	/**
	 * Show notification.
	 * @param  {Object} options Notification options
	 * @param  {Function} onClicked Function that will be called on notification click
	 * @return {Promise} Promise that will be resolved with notification ID
	 */
	function showNotification(options, onClicked) {
		if (!isAvailable()) {
			return Promise.reject();
		}

		if (typeof onClicked === 'function') {
			options.isClickable = true;
		}

		for (let key in DEFAULT_OPTIONS_VALUES) {
			if (options[key]) {
				continue;
			}

			let defaultValue = DEFAULT_OPTIONS_VALUES[key];
			options[key] = defaultValue;
		}

		return new Promise((resolve, reject) => {
			const notificationCreatedCb = (notificationId) => {
				if (onClicked) {
					addOnClickedListener(notificationId, onClicked);
				}
				resolve(notificationId);
			};
			const createNotification = function(permissionLevel) {
				if (permissionLevel !== 'granted') {
					reject();
					return;
				}
				try {
					chrome.notifications.create('', options, notificationCreatedCb);
				} catch (e) {
					reject(e);
				}
			};

			chrome.notifications.getPermissionLevel(createNotification);
		});
	}

	/**
	 * Show 'Now playing' notification.
	 * @param  {Object} song Copy of song instance
	 */
	function showPlaying(song) {
		if (!isAllowed()) {
			return;
		}

		let contextMessage = getCurrentTime();
		if (song.metadata.connector) {
			let connectorLabel = song.metadata.connector.label;
			contextMessage = `${contextMessage} · ${connectorLabel}`;
		}

		var options = {
			iconUrl: song.getTrackArt() || 'icons/default_cover_art.png',
			title: song.getTrack(),
			message: 'by ' + song.getArtist(),
			contextMessage
		};
		showNotification(options, null).then((notificationId) => {
			GA.event('notification', 'playing', 'show');
			song.metadata.attr('notificationId', notificationId);
		}).catch(nop);
	}

	/**
	 * Show error notificiation.
	 * @param  {String} message Notification message
	 * @param  {Function} onClick Function that will be called on notification click
	 */
	function showError(message, onClick = null) {
		const options = {
			title: 'Web scrobbler error',
			message: message,
		};
		showNotification(options, onClick).then(() => {
			GA.event('notification', 'error', 'show');
		}).catch(nop);
	}

	/**
	 * Show error notification if user is unable to sign in to Last.fm.
	 */
	function showSignInError() {
		showError(SIGN_IN_ERROR_MESSAGE, () => {
			chrome.tabs.create({ url: 'http://status.last.fm/' });
		});
	}

	/**
	 * Show auth notification.
	 *
	 * @param {Promise} authUrlGetter Promise that will resolve with auth URL
	 */
	function showAuthenticate(authUrlGetter) {
		authUrlGetter().then((authUrl) => {
			const options = {
				title: 'Connect your Last.FM account',
				message: 'Click the notification or connect later in the extension options page',
			};
			function onClicked() {
				GA.event('notification', 'authenticate', 'click');

				window.open(authUrl, 'scrobbler-auth');
			}

			showNotification(options, onClicked).then(() => {
				GA.event('notification', 'authenticate', 'show');
			}).catch(() => {
				GA.event('notification', 'authenticate', 'open-unavailable');

				// fallback for browsers with no notifications support
				window.open(authUrl, 'scrobbler-auth');
			});
		}).catch(showSignInError);
	}

	/**
	 * Completely remove notification.
	 * Do nothing if ID does not match any existing notification.
	 *
	 * @param  {String} notificationId Notification ID
	 */
	function remove(notificationId) {
		var onCleared = function() {
			// nop
		};

		if (notificationId) {
			chrome.notifications.clear(notificationId, onCleared);
		}
	}

	/**
	 * Get current time in hh:mm am/pm format.
	 * @return {String} Formatted time string
	 */
	function getCurrentTime() {
		let date = new Date();

		let hours = date.getHours();
		let minutes = date.getMinutes();
		let ampm = hours >= 12 ? 'pm' : 'am';

		hours = hours % 12;
		hours = hours ? hours : 12; // the hour '0' should be '12'
		minutes = minutes < 10 ? '0' + minutes : minutes;

		return `${hours}:${minutes}${ampm}`;
	}

	/**
	 * Do nothing. Used to suppress Promise errors.
	 */
	function nop() {
		// do nothing
	}

	// Set up listening for clicks on all notifications
	chrome.notifications.onClicked.addListener(function(notificationId) {
		console.log('Notification onClicked: ' + notificationId);

		if (clickListeners[notificationId]) {
			clickListeners[notificationId](notificationId);
		}
	});
	chrome.notifications.onClosed.addListener((notificationId) => {
		removeOnClickedListener(notificationId);
	});

	// Define getPermissionLevel missing on firefox browser
	if (chrome.notifications.getPermissionLevel == undefined) { 
		chrome.notifications.getPermissionLevel = function(notification) {
				notification("granted");
			}
	}

	return {
		showPlaying: showPlaying,
		showError: showError,
		showAuthenticate: showAuthenticate,
		remove: remove
	};

});
