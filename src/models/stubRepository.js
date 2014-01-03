'use strict';

var predicates = require('./predicates'),
    Q = require('q'),
    util = require('util'),
    errors = require('../errors/errors');

function create (resolver) {
    var stubs = [];

    function trueForAll (obj, predicate) {
        // we call map before calling every so we make sure to call every
        // predicate during dry run validation rather than short-circuiting
        return Object.keys(obj).map(predicate).every(function (result) { return result; });
    }

    function matchesPredicate (fieldName, predicate, request) {
        if (typeof predicate !== 'object' || util.isArray(predicate)) {
            throw errors.ValidationError('predicate must be an object', { source: predicate });
        }

        return trueForAll(predicate, function (key) {
            if (predicates[key]) {
                return predicates[key](fieldName, predicate[key], request);
            }
            else if (typeof predicate[key] === 'object') {
                return matchesPredicate(fieldName + '.' + key, predicate[key], request);
            }
            else {
                throw errors.ValidationError("no predicate '" + key + "'", { source: predicate });
            }
        });
    }

    function findFirstMatch (request, logger) {
        if (stubs.length === 0) {
            return undefined;
        }
        var matches = stubs.filter(function (stub) {
            var predicates = stub.predicates || {};
            return trueForAll(predicates, function (fieldName) {
                return matchesPredicate(fieldName, predicates[fieldName], request);
            });
        });
        if (matches.length === 0) {
            logger.debug('no predicate match');
            return undefined;
        }
        else {
            logger.debug('using predicate match: ' + JSON.stringify(matches[0].predicates || {}));
            return matches[0];
        }
    }

    function addStub (stub) {
        stubs.push(stub);
    }

    function resolve (request, logger) {
        var stub = findFirstMatch(request, logger) || { responses: [{ is: {} }]},
            stubResolver = stub.responses.shift(),
            deferred = Q.defer();

        stub.responses.push(stubResolver);

        resolver.resolve(stubResolver, request, logger, stubs).done(function (response) {
            var match = {
                    timestamp: new Date().toJSON(),
                    request: request,
                    response: response
                };
            stub.matches = stub.matches || [];
            stub.matches.push(match);
            deferred.resolve(response);
        }, deferred.reject);

        return deferred.promise;
    }

    return {
        addStub: addStub,
        resolve: resolve
    };
}

module.exports = {
    create: create
};