
const ASSERT = require("assert");
const PATH = require("path");
const WAITFOR = require("waitfor");
const DEEPMERGE = require("deepmerge");
const CRYPTO = require("crypto");
const FS = require("fs");
const PACKAGE_INSIGHT = require("pinf-it-package-insight");


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

	var helpers = PACKAGE_INSIGHT.makeMergeHelpers(exports, descriptor, copied);

	try {

		helpers.mergeObjectTo("boot", "boot");

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

