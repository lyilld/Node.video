"use strict";

var fs = require('fs');
var url = require('url');
var events = require('events');
var promise = require('promise');
var colors  = require('colors');
var settings = require('./config.json');
var Throttle = require('throttle');
var ffmpeg = require('fluent-ffmpeg');

var handler = new events.EventEmitter();

var mimeTypes = require('./mime_types');

var ffmpegKeyGen = 0;
var ffmpegHash = {};
var dataHash = {};
var startup_date = new Date;

var spiderStreamer = function(data, query, range_string, res) {
	var stream;
	var info = {};
	var ext;
	var range;
	var i;
	var timer_id;
  console.log("- Enter to spiderStreamer -".cyan);
	ext = data.name.match(/.*(\..+?)$/);

	if (ext === null || ext.length !== 2 || (info.mime = mimeTypes[ext[1].toLowerCase()]) === undefined) {
		console.error('spiderStreamer Error:'.red, 'Invalid mime type:', data.name);
		handler.emit("badMime", res);
		return false;
	}

	console.error('spiderStreamer Notice: Mime type'.yellow, info.mime, 'found for file:'.yellow, data.name);

	info.file = data.name;
	info.path = data.path;
	info.size = data.length;
	info.modified = data.date;

	new Promise(function(fulfill, reject) {
		if (info.mime !== "video/mp4" && info.mime !== "video/webm" && info.mime !== "video/ogg") {
			console.log('spiderStreamer : Needs to be converted to video/mp4:'.red, info.path);
			var old_path = info.path;
			var converted_path = info.path+'.converted.mp4';
			var converted_file = info.file+'.converted.mp4';
			var key = ++ffmpegKeyGen;
			if (ffmpegHash[old_path] === undefined) {
				console.log('fluent-ffmpeg Notice:'.yellow.italic, key+':', 'Movie not yet converted, competing for key...'.yellow.italic);
				ffmpegHash[old_path] = key;
			}
			if (ffmpegHash[old_path] === key) {
				console.log('spiderStreamer Notice: Converting to video/mp4'.green);
				var fails = 0;
				var busy = false;
				var interval_id = setInterval(function() {
					if (!busy) {
						busy = true;
						try {
							ffmpeg().input(old_path).setFfmpegPath('node_modules/ffmpeg').setFfprobePath('node_modules/ffprobe')
								.on("error", function(err, stdout, stderr) {
									console.error('spiderStreamer Error:'.red, 'Could not convert file:', old_path);
									++fails;
									busy = false;
								})
								.on('start', function(cmd) {
									console.log('fluent-ffmpeg: Started:'.green, cmd);
								})
                .on('progress', function(progress){
                  console.log("Frames".magenta, progress.timemark);
                })
								.on('codecData', function(data) {
									clearInterval(interval_id);
									fulfill(data);
									dataHash[old_path] = data;
								})
								.audioCodec('aac')
								.videoCodec('libx264')
								.output(converted_path)
								.outputFormat('mp4')
								.outputOptions('-movflags frag_keyframe+empty_moov')
								.run();
						} catch(exception) {
							console.error('spiderStreamer Error:'.red, 'Could not convert file:'.red, old_path);
							++fails;
							busy = false;
						}
					} else {
						console.log('fluent-ffmpeg is busy'.red.italic);
					}
					if (fails > 30 && busy === false) {
						clearInterval(interval_id);
						reject('fluent-ffmpeg never launched without error'.red);
					}
				}, 3000);
			} else {
				console.log('fluent-ffmpeg Notice:'.green, key+':', 'Movie already converted'.green, "this path is :".green, old_path);
				fulfill(dataHash[old_path]);
			}

			info.file = converted_file;
			info.path = converted_path;
			info.mime = 'video/mp4';
			info.modified = new Date;
			try {
				info.size = fs.statSync(info.path).size;
			} catch(exception) {
				console.log('spiderStreamer Error : Converted movie size not found'.red);
				info.size = 0;
			}
		} else {
			console.log('spiderStreamer Notice: No conversion needed:'.green, info.file);
			fulfill(false);
		}
	}).then(
		function(success) {
			new Promise(function(fulfill, reject) {
				var fails = 0;
				var interval_id = setInterval(function() {
					try {
						info.size = fs.statSync(info.path).size;
						console.log('spiderStreamer Notice: try this file lenght'.magenta, info.path, ' size:'.red, info.size);
						if (info.size > 5000000) {
              console.log("IN off lenght".green);
							clearInterval(interval_id);
							fulfill(info.size);
							return;
						}
						console.log('spiderStreamer Notice: Movie file not yet big enough; fails:'.red.italic, fails);
					} catch(exception) {
						console.error('spiderStreamer Error:'.red, exception);
					}
					++fails;
					if (fails > 30) {
						clearInterval(interval_id);
						reject(' !!! Movie file never grew to at least 5mb'.red);
					}
				}, 5000);
			}).then(
				function(success) {
          console.log('settings streaming with this lenght'.cyan, data.length, range, range_string);
					info.rangeRequest = false;
					info.start = 0;
					info.end = data.length - 1;
          console.log("start calc".yellow);
					if (range_string && (range = range_string.match(/bytes=(.+)-(.+)?/)) !== null) {
            console.log("first calc".yellow);
						info.start = isNumber(range[1]) && range[1] >= 0 && range[1] < info.end ? range[1] - 0 : info.start;
						info.end = isNumber(range[2]) && range[2] > info.start && range[2] <= info.end ? range[2] - 0 : info.end;
						info.rangeRequest = true;
					} //else if (query.start || query.end) {
          //   console.log("seconds calc".yellow);
					// 	 This is a range request, but doesn't get range headers. So there.
					// 	info.start = isNumber(query.start) && query.start >= 0 && query.start < info.end ? query.start - 0 : info.start;
					// 	info.end = isNumber(query.end) && query.end > info.start && query.end <= info.end ? query.end - 0 : info.end;
					// }

          console.log("end calcule".yellow);
          //info.end = data.length - 1;
					info.length = info.end - info.start + 1;

					console.log('spiderStreamer Notice: Sending header'.green.italic);

					if(info.file.indexOf(".converted.mp4") == -1)
						downloadHeader(res, info);
					else {
						downloadHeader_2(res, info);
					}
          console.log("HEADERS sent".green, "try to stream now".cyan)
					try {
						stream = fs.createReadStream(info.path, { flags: "r", start: info.start, end: info.end });
						if (settings.throttle) {
							stream = stream.pipe(new Throttle(settings.throttle));
						}
						console.log('spiderStreamer Notice: Piping stream...'.blue);
						stream.pipe(res);
						console.log('spiderStreamer Notice: Pipe set'.blue);
					} catch(exception) {
						stream = null;
						i = 0;
						console.log('spiderStreamer Error:'.red, exception);
						console.log('spiderStreamer Notice: Retrying... i:', i);
						timer_id = setInterval(function() {
							++i;
							if (stream === null) {
								if (i === 5) {
									clearInterval(timer_id);
									console.error('spiderStreamer Error:'.red, 'Could not stream file:', info.path);
									return;
								}

								try {
									stream = fs.createReadStream(info.path, { flags: "r", start: info.start, end: info.end });
								} catch(exception) {
									console.log('spiderStreamer Error:'.red, exception);
									console.log('spiderStreamer Notice: Retrying in 3 seconds... i:', i);
									stream = null
								}
								if (stream !== null) {
									clearInterval(timer_id);
									if (settings.throttle) {
										stream = stream.pipe(new Throttle(settings.throttle));
									}
									console.log('spiderStreamer Notice: Piping stream...');
									stream.pipe(res);
									console.log('spiderStreamer Notice: Pipe set');
								}
							} else if (stream !== null) {
								clearInterval(timer_id);
							}
						}, 3000);
					}
				},
				function(failure) {
					console.log('spiderStreamer Error:'.red, failure);
				}
			);
		},
		function(failure) {
			console.log('spiderStreamer Error:'.red, failure);
		}
	);
};

spiderStreamer.settings = function(s) {
	for (var prop in s) { settings[prop] = s[prop]; }
	return spiderStreamer;
};

var downloadHeader = function(res, info) {
	console.log('downloadHeader'.green);
	var code = 200;
	var header;

	if (settings.forceDownload) {
			res.setHeader('Expires', 0);
      res.setHeader('Cache-Control', 'must-revalidate, post-check=0, pre-check=0');
      res.setHeader('Content-Type', info.mime);
      res.setHeader('Content-Disposition', 'attachment; filename=' + info.file);
	} else {
    res.setHeader('Cache-Control', 'public; max-age=' + settings.maxAge);
    res.setHeader('Content-Type', info.mime);
    res.setHeader('Content-Disposition', 'inline; filename=' + info.file);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Connection', 'keep-alive');

		if (info.rangeRequest) {
			code = 206;
      res.setHeader('Status', '206 Partial Content');
			res.setHeader('Content-Range', 'bytes ' + info.start + '-' + info.end + '/' + info.size);
		}
	}

  res.setHeader('Pragma', 'public');
	//res.setHeader('Last-Modified', info.modified.toUTCString);
	res.setHeader('Content-Transfer-Encoding', 'binary');
	res.setHeader('Content-Length', info.length);
    if(settings.cors){
        res.setHeader('Access-Control-Allow-Origin',  '*');
        res.setHeader('Access-Control-Allow-Headers', 'Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.setHeader('Server', settings.server);

	res.writeHead(code, header);
};

var downloadHeader_2 = function(res, info) {
	console.log('downloadHeader_2'.green);
	var code = 200;
	var header;

	if (settings.forceDownload) {
			res.setHeader('Expires', 0);
      res.setHeader('Cache-Control', 'must-revalidate, post-check=0, pre-check=0');
      res.setHeader('Content-Type', info.mime);
      res.setHeader('Content-Disposition', 'attachment; filename=' + info.file);
	} else {
    res.setHeader('Cache-Control', 'public; max-age=' + settings.maxAge);
    res.setHeader('Content-Type', info.mime);
    res.setHeader('Content-Disposition', 'inline; filename=' + info.file);
  //  res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Connection', 'keep-alive');
		if (info.rangeRequest) {
			code = 206;
      res.setHeader('Status', '206 Partial Content');
			res.setHeader('Content-Range', 'bytes ' + info.start + '-' + info.end + '/' + info.size);
		}
	}

  res.setHeader('Pragma', 'public');
	//res.setHeader('Last-Modified', info.modified.toUTCString);
	res.setHeader('Content-Transfer-Encoding', 'binary');
	res.setHeader('Content-Length', info.length);
    if(settings.cors){
        res.setHeader('Access-Control-Allow-Origin',  '*');
        res.setHeader('Access-Control-Allow-Headers', 'Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.setHeader('Server', settings.server);

	//res.writeHead(code, header);
};

var errorHeader = function(res, code) {
	var header = {
		"Content-Type": "text/html",
		Server: settings.server
	};

	res.writeHead(code, header);
};

var pack = function(format) {
	var result = "";

	for (var pos = 1, len = arguments.length; pos < len; pos++) {
		if (format[pos - 1] == "N") {
			result += String.fromCharCode(arguments[pos] >> 24 & 0xFF);
			result += String.fromCharCode(arguments[pos] >> 16 & 0xFF);
			result += String.fromCharCode(arguments[pos] >> 8 & 0xFF);
			result += String.fromCharCode(arguments[pos] & 0xFF);
		} else {
			result += String.fromCharCode(arguments[pos]);
		}
	}

	return result;
};

var isNumber = function (n) {
	return !isNaN(parseFloat(n)) && isFinite(n);
};

module.exports = spiderStreamer;
