'use strict';

/* global Connector, MetadataFilter */

/**
 * Allow or disallow to scrobble videos that are in Music category only.
 * @type {Boolean}
 */
let scrobbleMusicOnly = false;

/**
 * CSS selector of video element. It's common for both players.
 * @type {String}
 */
const videoSelector = '.html5-main-video';

/**
 * Setup connector according to current Youtube design.
 * This function is called on connector inject.
 */
function setupConnector() {
	if (isDefaultPlayer()) {
		readConnectorOptions();

		setupBasePlayer();
		setupDefaultPlayer();
	} else {
		setupBasePlayer();
		setupMaterialPlayer();
	}
}

/**
 * Check if default player on the page.
 * @return {Boolean} True if default player is on the page; false otherwise
 */
function isDefaultPlayer() {
	return $('ytd-app').length === 0;
}

/**
 * Setup default Youtube player.
 */
function setupDefaultPlayer() {
	Connector.getArtistTrack = function () {
		let text = getItemPropValue('name');
		return processYoutubeVideoTitle(text);
	};

	Connector.getUniqueID = function() {
		return getItemPropValue('videoId');
	};

	Connector.isStateChangeAllowed = function() {
		let videoCategory = getItemPropValue('genre');
		if (videoCategory) {
			return !scrobbleMusicOnly ||
				(scrobbleMusicOnly && videoCategory === 'Music');
		}

		// Unable to get a video category; allow to scrobble the video
		return true;
	};

	/**
	 * Check if player is off screen.
	 *
	 * YouTube doesn't really unload the player. It simply moves it outside
	 * viewport. That has to be checked, because our selectors are still able
	 * to detect it.
	 *
	 * @return {Boolean} True if player is off screen; false otherwise
	 */
	Connector.isPlayerOffscreen = function() {
		let $player = $('#player-api');
		if ($player.length === 0) {
			return false;
		}

		let offset = $player.offset();
		return offset.left < 0 || offset.top < 0;
	};

	function getItemPropValue(prop) {
		return $(`meta[itemprop="${prop}"]`).attr('content');
	}
}

/**
 * Setup Material player.
 */
function setupMaterialPlayer() {
	Connector.getArtistTrack = function() {
		/*
		 * Youtube doesn't remove DOM object on AJAX navigation,
		 * so we should not return track data if no song is playing.
		 */
		if (Connector.isPlayerOffscreen()) {
			return { artist: null, track: null };
		}

		let text = $('h1.title.ytd-video-primary-info-renderer').text();
		return processYoutubeVideoTitle(text);
	};

	Connector.getUniqueID = function() {
		/*
		 * Youtube doesn't remove DOM object on AJAX navigation,
		 * so we should not return track data if no song is playing.
		 */
		if (Connector.isPlayerOffscreen()) {
			return null;
		}

		let videoUrl = $('.ytp-title-link').attr('href');
		let regExp = /v=(.+)&?/;
		let match = videoUrl.match(regExp);
		if (match) {
			return match[1];
		}

		return null;
	};

	/**
	 * Check if player is off screen.
	 *
	 * YouTube doesn't really unload the player. It simply moves it outside
	 * viewport. That has to be checked, because our selectors are still able
	 * to detect it.
	 *
	 * @return {Boolean} True if player is off screen; false otherwise
	 */
	Connector.isPlayerOffscreen = function() {
		let $player = $('#player-container');
		if ($player.length === 0) {
			return false;
		}

		let offset = $player.offset();
		return offset.left <= 0 || offset.top <= 0;
	};
}

/**
 * Setup common things for both players.
 */
function setupBasePlayer() {
	setupMutationObserver();

	Connector.filter = MetadataFilter.getYoutubeFilter();

	/*
	 * Because player can be still present in the page, we need to detect
	 * that it's invisible and don't return current time. Otherwise resulting
	 * state may not be considered empty.
	 */
	Connector.getCurrentTime = function() {
		if (Connector.isPlayerOffscreen()) {
			return null;
		}
		return $(videoSelector).prop('currentTime');
	};

	Connector.getDuration = function() {
		if (Connector.isPlayerOffscreen()) {
			return null;
		}
		return $(videoSelector).prop('duration');
	};

	Connector.isPlaying = function() {
		return $('.html5-video-player').hasClass('playing-mode');
	};

	function setupMutationObserver() {
		let isMusicVideoPresent = false;

		let playerObserver = new MutationObserver(function() {
			if (Connector.isPlayerOffscreen()) {
				Connector.onStateChanged();
			} else {
				if (isMusicVideoPresent) {
					return;
				}

				$(videoSelector).on('timeupdate', Connector.onStateChanged);
				isMusicVideoPresent = true;
			}
		});

		playerObserver.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: false,
			characterData: false
		});
	}
}

/**
 * Parse Youtube video title and return object that contains information
 * about song artist and song title.
 * @param  {String} text Video title
 * @return {Object} Object that contains information aboud artist and track
 */
function processYoutubeVideoTitle(text) {
	if (!text) {
		return { artist: null, track: null };
	}

	// Remove [genre] from the beginning of the title
	text = text.replace(/^\[[^\]]+\]\s*-*\s*/i, '');

	let {artist, track} = Connector.splitArtistTrack(text);
	if (artist === null && track === null) {
		// Look for Artist "Track"
		let artistTrack = text.match(/(.+?)\s"(.+?)"/);
		if (artistTrack) {
			artist = artistTrack[1];
			track = artistTrack[2];
		}
	}
	return { artist, track };
}

/**
 * Asynchronously read connector options.
 */
function readConnectorOptions() {
	chrome.storage.local.get('Connectors', function(data) {
		if (data && data.Connectors && data.Connectors.YouTube) {
			let options = data.Connectors.YouTube;
			if (options.scrobbleMusicOnly === true) {
				scrobbleMusicOnly = true;
			}

			console.log(`connector options: ${JSON.stringify(options)}`);
		}
	});
}

setupConnector();
