
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

			function followDependencies(descriptor, callback) {
				if (
					!descriptor.combined.dependencies ||
					!descriptor.combined.dependencies.bundled
				) {
					return callback(null);
				}
				var waitfor = WAITFOR.serial(callback);
				for (var alias in descriptor.combined.dependencies.bundled) {
					waitfor(alias, function(alias, done) {
						return followPackage(PATH.join(descriptor.dirpath, descriptor.combined.dependencies.bundled[alias]), done);
					});
				}
				return waitfor();
			}

			function followPackage(uri, callback) {
				if (
					programDescriptor.combined.packages &&
					programDescriptor.combined.packages[uri]
				) {
					return callback(null);
				}
				return PACKAGE_INSIGHT.parse(uri, options, function(err, descriptor) {
					if (!programDescriptor.combined.packages) {
						programDescriptor.combined.packages = {};
					}
					programDescriptor.combined.packages[uri] = descriptor;
					return followDependencies(descriptor, callback);
				});
			}

			// Now that we have the program descriptor we parse the boot package
			// and include all linked package descriptors in our program descriptor.
			if (
				!programDescriptor.combined.boot ||
				!programDescriptor.combined.boot.package
			) {
				return callback(null, programDescriptor);
			}
			return followPackage(programDescriptor.combined.boot.package, function(err) {
				if (err) return callback(err);

				return callback(null, programDescriptor);
			});
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

		options._relpath = function(path) {
			if (!path || !options.rootPath || !/^\//.test(path)) return path;
			return PATH.relative(options.rootPath, path);
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

		function extraNormalization(callback) {

			function normalize(property, callback) {
				if (property === "boot.package") {
					if (
						descriptor.normalized.boot &&
						descriptor.normalized.boot.package &&
						/^\./.test(descriptor.normalized.boot.package)
					) {
						descriptor.normalized.boot.package = options._relpath(PATH.join(PATH.dirname(options._realpath(descriptorPath)), descriptor.normalized.boot.package));
					}
				}
				return callback(null);
			}

			return normalize("boot.package", callback);				
		}

		return extraNormalization(function(err) {
			if (err) return callback(err);

			Object.keys(descriptor.raw).forEach(function(key) {
				if (copied[key]) return;
				descriptor.warnings.push([
					"normalize", "Property '" + key + "' was ignored"
				]);
			});

			return callback(null);
		});

	} catch(err) {
		return callback(err);
	}
};

