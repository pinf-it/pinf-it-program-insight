
const ASSERT = require("assert");
const PATH = require("path");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const CRYPTO = require("crypto");
const FS = require("fs");


exports.parse = function(programPath, options, callback) {
	try {

		options._realpath = function(path) {
			if (!options.rootPath) return path;
			if (/^\//.test(path)) return path;
			return PATH.join(options.rootPath, path);
		}

		ASSERT(FS.existsSync(options._realpath(programPath)), "path '" + options._realpath(programPath) + "' does not exist");
		ASSERT(FS.statSync(options._realpath(programPath)).isDirectory());

		var shasum = CRYPTO.createHash("sha1");
		shasum.update(programPath);

		var programDescriptor = {
			dirpath: programPath,
			id: shasum.digest("hex") + "-" + PATH.basename(programPath),
			raw: {},
			normalized: {},
			combined: {},
			warnings: [],
			errors: []
		};

		var waitfor = WAITFOR.serial(function(err) {
			if (err) return callback(err);

			return callback(null, programDescriptor);
		});

		var opts = {};
		for (var key in options) {
			opts[key] = options[key];
		}
		opts.programPath = programPath;

		// TODO: Get list of files to search from `pinf-for-nodejs/lib/context.LOOKUP_PATHS`. Exclude the 'package' paths.
		[
			"program.json"
		].forEach(function(filename) {
			waitfor(function(done) {
				return exports.parseDescriptor(PATH.join(programPath, filename), opts, function(err, descriptor) {
					if (err) return done(err);

					programDescriptor.raw[filename] = descriptor.raw;
					programDescriptor.normalized[filename] = descriptor.normalized;

					programDescriptor.combined = DEEPMERGE(programDescriptor.combined, descriptor.normalized);

					descriptor.warnings.forEach(function(warning) {
						programDescriptor.warnings.push([].concat(warning, "descriptor", filename));
					});
					descriptor.errors.forEach(function(error) {
						programDescriptor.errors.push([].concat(error, "descriptor", filename));
					});

					return done(null);
				});
			});
		});
		return waitfor();

	} catch(err) {
		return callback(err);
	}
}

exports.parseDescriptor = function(descriptorPath, options, callback) {
	try {

		options = options || {};

		options.programPath = options.programPath || PATH.dirname(descriptorPath);

		options._realpath = function(path) {
			if (!options.rootPath) return path;
			if (/^\//.test(path)) return path;
			return PATH.join(options.rootPath, path);
		}

		var descriptor = {
			raw: null,
			normalized: {},
			warnings: [],
			errors: []
		};

		function populateRaw(callback) {
			if (typeof descriptorPath === "string") {
				return FS.exists(options._realpath(descriptorPath), function(exists) {
					if (exists) {
						descriptor.raw = JSON.parse(FS.readFileSync(options._realpath(descriptorPath)));
					} else {
						descriptor.raw = {};
					}
					return callback(null);
				});
			} else {
				ASSERT(typeof descriptorPath, "object");
				descriptor.raw  = descriptorPath;
				ASSERT(typeof descriptor.raw, "object");
				descriptorPath = null;
				return callback(null);
			}
		}

		return populateRaw(function(err) {
			if (err) return callback(err);

			return normalize(descriptorPath, descriptor, options, function(err) {
				if (err) {
					descriptor.errors.push([
						"normalize", err.message, err.stack
					]);
				}
				return callback(null, descriptor);
			});
		});

	} catch(err) {
		return callback(err);
	}
}


// TODO: Normalize the values of the various properties to ensure they all follow standard formats.
function normalize(descriptorPath, descriptor, options, callback) {

	var copied = {};

	// TODO: Get utility methods from `pinf-it-package-insight`.
	function string(key) {
		if (typeof descriptor.raw[key] === "string") {
			descriptor.normalized[key] = descriptor.raw[key];
			copied[key] = true;
		}
	}
	function stringToArray(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] === "string") {
			anyToArray(key, targetKey, formatter);
		}
	}
	function booleanToObject(key, targetKey) {
		if (typeof descriptor.raw[key] === "boolean") {
			anyToObject(key, targetKey);
		}
	}
	function stringToObject(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] === "string") {
			anyToObject(key, targetKey, formatter);
		}
	}
	function objectToObject(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] === "object") {
			if (Object.keys(descriptor.raw[key]).length > 0) {
				anyToObject(key, targetKey, formatter);
			}
			copied[key] = true;
		}
	}
	function arrayToObject(key, targetKey, formatter) {
		if (descriptor.raw[key] && Array.isArray(descriptor.raw[key])) {
			if (descriptor.raw[key].length > 0) {
				anyToObject(key, targetKey, formatter);
			}
			copied[key] = true;
		}
	}
	function array(key) {
		if (descriptor.raw[key] && Array.isArray(descriptor.raw[key])) {
			if (descriptor.raw[key].length > 0) {
				descriptor.normalized[key] = descriptor.raw[key];
			}
			copied[key] = true;
		}
	}
	function object(key) {
		if (descriptor.raw[key] && typeof descriptor.raw[key] === "object") {
			descriptor.normalized[key] = descriptor.raw[key];
			copied[key] = true;
		}
	}
	function mergeObjectTo(key, targetKey, formatter) {
		if (descriptor.raw[key] && typeof descriptor.raw[key] === "object") {
			if (typeof targetKey === "string") {
				targetKey = [
					targetKey
				];
			}
			if (!descriptor.normalized[targetKey[0]]) {
				descriptor.normalized[targetKey[0]] = {};
			}
			var target = descriptor.normalized[targetKey[0]];
			if (targetKey.length === 2) {
				if (!target[targetKey[1]]) {
					target[targetKey[1]] = {};
				}
			    target = target[targetKey[1]];
			}

			for (var name in descriptor.raw[key]) {
				if (
					typeof target[name] !== "undefined" &&
					target[name] !== descriptor.raw[key][name]
				) {
					descriptor.warnings.push([
						"normalize", "Found existing value at '" + targetKey.join(".") + "." + name + "' while trying to merge from '" + key + "." + name + "'"
					]);
				} else {
					var value = descriptor.raw[key][name];
					if (typeof formatter === "function") {
						value = formatter(value);
					}
					target[name] = value;
				}
			}
			copied[key] = true;
		}
	}
	function anyToArray(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] !== "undefined") {
			if (!descriptor.normalized[targetKey]) {
				descriptor.normalized[targetKey] = [];
			}
			var value = descriptor.raw[key];
			if (typeof formatter === "function") {
				value = formatter(value);
			}
			descriptor.normalized[targetKey].unshift(value);
			copied[key] = true;
		}
	}
	function anyToObject(key, targetKey, formatter) {
		if (typeof descriptor.raw[key] !== "undefined") {
			if (typeof targetKey === "string") {
				targetKey = [
					key,
					targetKey
				];
			}
			if (targetKey[0] === "") {
				targetKey.shift();
			}
			var value = descriptor.raw[key];
			if (typeof formatter === "function") {
				value = formatter(value);
			}
			if (targetKey.length === 1) {
				descriptor.normalized[targetKey[0]] = value;
			} else {
				if (!descriptor.normalized[targetKey[0]]) {
					descriptor.normalized[targetKey[0]] = {};
				}
				if (targetKey.length === 2) {
					descriptor.normalized[targetKey[0]][targetKey[1]] = value;
				} else {
					if (!descriptor.normalized[targetKey[0]][targetKey[1]]) {
						descriptor.normalized[targetKey[0]][targetKey[1]] = {};
					}
					descriptor.normalized[targetKey[0]][targetKey[1]][targetKey[2]] = value;
				}
			}
			copied[key] = true;
		}
	}
	function removeIfMatch(key, match) {
		if (descriptor.raw[key] === match) {
			copied[key] = true;
		}
	}
	function remove(key, match) {
		copied[key] = true;
	}
	function prefixRelativePath(path) {
		if (/^(\.|\/)/.test(path)) return path;
		return "./" + path;
	}

	function normalizeSub(label, raw, options, callback) {
		return exports.parseDescriptor(raw, options, function(err, subDescriptor) {
			if (err) return callback(err);
			subDescriptor.warnings.forEach(function(warning) {
				warning[0] += "-" + label;
				descriptor.warnings.push(warning);
			});
			subDescriptor.errors.forEach(function(error) {
				error[0] += "-" + label;
				descriptor.errors.push(error);
			});
			return callback(null, subDescriptor.normalized);
		});
	}

	try {

		mergeObjectTo("boot", "boot");

		Object.keys(descriptor.raw).forEach(function(key) {
			if (copied[key]) return;
			descriptor.warnings.push([
				"normalize", "Property '" + key + "' was ignored"
			]);
		});

		return callback(null);

	} catch(err) {
		return callback(err);
	}
};

