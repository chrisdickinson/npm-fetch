'use strict'
var discern = require('discern')
var github = require('./github.js')
var url = require('url')
var net = require('net')

var gitTransport = require('git-transport-protocol')
var gitObjectify = require('git-objectify-pack')
var gitUnpack = require('git-list-pack')
var gitFetch = require('git-fetch-pack')
var gitWalk = require('git-walk-tree')
var through = require('through')


var protocol_to_transport = {
  'git:': git_tcp_transport
}

module.exports = function (name, spec, options) {
  if (false && discern.isGitHubUrl(spec)) {
    var res = discern.github(spec)
    spec = res[0] + '/' + res[1] + '#' + res[2]
    return github(name, spec, options)
  }

  var urlinfo = url.parse(spec)

  if(!supported(urlinfo.protocol)) {
    throw new Error(urlinfo.protocol + ' is not supported')
  }

  //todo: implement git
  return transport(urlinfo, name, options)
}

function supported(protocol) {
  return protocol in protocol_to_transport 
}

function transport(urlinfo, name, options) {
  return protocol_to_transport[urlinfo.protocol](urlinfo, name, options)
}

function git_tcp_transport(urlinfo, name, options) {
  var connectionInfo = {
      host: urlinfo.host
    , port: urlinfo.port || 9418
  }

  var client = gitFetch(url.format(urlinfo), wantRef, null)
  var conn = net.connect(connectionInfo)
  var oids = {}
  var pending = {}
  var refs = {}

  var input = through()
    , output = through()

  input.pipe(conn).pipe(output)

  input.pipe(process.stdout)

  client
    .pipe(gitTransport(require('duplexer')(input, output)))
    .pipe(client)

  client.refs
    .pipe(through(collectRefs))

  client.pack
    .pipe(gitUnpack())
    .pipe(gitObjectify(findRef))
    .pipe(through(catalogue, onend))

  function onend() {
    // good joerb
    var hash = (urlinfo.hash || '#HEAD').slice(1)
      , commit
      , ref

    ref = refs[hash]

    if(ref && ref.hash && oids['_' + ref.hash]) {
      commit = oids['_' + ref.hash]
    } else {
      var candidates = []

      for(var key in oids) {
        if(key.indexOf('_' + hash) === 0) {
          candidates.push(key)
        }
      }

      if(candidates.length !== 1) {
        return error('could not find ' + hash)
      }

      commit = oids[candidates[0]]
    }

    gitWalk(findRef, commit)
      .pipe(through(onentry))
  }

  function onentry(entry) {
    console.log(entry.looseType)
  }

  function collectRefs(ref) {
    if(!/\^\{\}$/.test(ref.name)) {
      refs[ref.name] = ref
    }
  }

  function wantRef(ref, ready) {
    return ready(!/\^\{\}$/.test(ref.name))
  }

  function findRef(oid, ready) {
    oid = '_' + (typeof oid === 'string' ? oid : oid.toString('hex'))

    if(!oids[oid]) {
      return pending[oid] = ready
    }

    setImmediate(function() {
      return ready(null, oids[oid])
    })
  }

  function catalogue(obj) {
    var hash = '_' + obj.hash.toString('hex')

    oids[hash] = obj 

    if(pending[hash]) {
      pending[hash](null, obj)
      pending[hash] = null
    }
  }
}
