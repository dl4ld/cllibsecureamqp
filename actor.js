const SecureAmqp = require('./secureamqp.js')
const randomstring = require('randomstring')
const oneYear = 525949

module.exports = function Actor(config) {
	
	this.secureAmqp = new SecureAmqp(config)
	this.parents = {}
	this.children = {}
	this.abilities = {}
	this.events = {}
    this.data = {}
	this.dataListeners = {}
	this.dataObjects = {}
	this.trust = {
		
	}
	this.type = config.type || "None"


	this.boot = async function() {
		const that = this
		await this.secureAmqp.init(config)
		// respond to query for manifests
		this.secureAmqp.registerFunction('.i.manifests', [], function(req, res) {
			// build manifest list
			const manifests = Object.keys(that.dataObjects).map(k => {
				return that.dataObjects[k].manifest
			})

			res.send(manifests, 200)
		})
		// respond to query for abilities
		this.secureAmqp.registerFunction('.i.abilities', [], function(req, res) {
			// build manifest list
			const abilities = Object.keys(that.abilities).map(k => {
				return that.abilities[k]
			})

			res.send(abilities, 200)
		})
	}

	this.addTrustedActor = function(id, abilities, data, events) {
		this.trust[id] = {
			abilities: abilities || [],
			data: data || [],
			events: events || []
		}
	}

	this.privateKey = function() {
		return this.secureAmqp.keys().privateKey
	}
	
	this.id = function() {
		return this.secureAmqp.getMyAddress()
	}

	this.listenToEvent = function(event, f) {
		return this.secureAmqp.subscribeEvent(event, f)
	}

	this.monitorInteractions = function(f) {
		return this.secureAmqp.monitorFunctions(f)
	}

	this.listenToMessages = function(f) {
		return this.secureAmqp.registerFunction(".f.message", [], f)
	}

	this.broadcast = function(name, type, data) {
		const rk = this.id() + '.e.' + name
		return this.secureAmqp.emitEvent(name, type, data , null)
	}

	this.talkToActor = function(actorId) {
		const that = this
		function responseOk(res) {
			const c = parseInt(res.msg.status)
			if(!c) {
				return false
			}
			if((c >= 200) && (c < 300)) {

				return true
			} 
			return false
		}
		return {
			sendMessage: function(params) {
				const headers = {}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.f.message', params, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})
			},
			call: function(name, opToken, params) {
				const tokens = (Array.isArray(opToken)) ? opTokens.join(',') : opToken
				const headers = {
					opAccessToken: tokens
				}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.f.' + name, params, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})
			},
			interestInAsset: function(name, token, f) {
				const headers = {}
				headers.opAccessToken = token
				const replyId = '.c.' + randomstring.generate(5)
				const callbackRk = that.id()  + replyId
				const params = {
					periodicity: "changes",
					callback: callbackRk
				}

				that.secureAmqp.registerFunction(replyId, [], f)

				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.d.' + name, params, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})
			},
			requestAllAbilities: function() {
				const headers = {}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.i.abilities', {}, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})
			},
			requestAllManifests: function() {
				const headers = {}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.i.manifests', {}, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})
			},
			requestManifest: function(name) {
				const headers = {}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.m.' + name, {}, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})
			},
			requestAsset: function(name, tokens) {
				const headers = {}
				headers.opAccessToken = tokens
				const params = {
					periodicity: "once"
				}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.d.' + name, params, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})
			},
			requestSignature: function(op) {
				const headers = {}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.f.sign', op, null, headers, function(res) {
						if(responseOk(res)) {
							resolve(res.msg.response)
						} else { 
							reject(res.msg)
						}
					})
				})

			}
		}
	}

	this.updateData = function(name, manifest, data) {
		this.dataObjects[name] = {
			manifest: manifest,
			data: data
		}
		const listeners = this.dataListeners[name]
		if(!listeners) {
			return
		}

		listeners
			.filter(l => {	
				const token = l.token
				const decodedToken = this.secureAmqp.decodeToken(l.token)
				if(!decodedToken) {
					console.log("token error")
					return false
				}
				const issuer = decodedToken.issuer
				return this.secureAmqp.verifyToken(token, issuer)
			})
			.forEach(l => {
				const address = l.callback.split('.')
				const actorId = address.shift()
				const call = '.' + address.join('.')
				const payload = {
					manifest: manifest,
					data: data
				}
				const headers = {}
				this.secureAmqp.callFunction(actorId, call, payload, null, headers, function(res) {
					console.log("in return: ", call)
				})

			})
	}

	this.exposeAsset = function(name, manifest, data, f) {
		const manifestRk = '.m.' + name
		const dataRk = '.d.' + name
		const authActors = manifest.authActors
		const that = this
		this.dataObjects[name] = {
			manifest: manifest,
			data: data
		}
		this.dataListeners[name] = []
		function checkToken(req) {
			console.log(req)
			const tokens = req.header.opAccessToken.split(',')
			let validate = false
			tokens.forEach(t => {
				const check = authActors.some(k => {
					const token = that.secureAmqp.verifyToken(t, k)
					console.log("verifyToken: ", token)
					return token
				})

			})
			return true
		}

		this.secureAmqp.registerFunction(manifestRk, [], function(req, res) {
			res.send(manifest, 200)
		})

		this.secureAmqp.registerFunction(dataRk, [checkToken], function(req, res) {
			console.log("access granted to ", name)
			const params = req.msg || {}
			console.log(params)
			if(params.periodicity == 'once') {
				res.send(data, 200)
				return
			}
			if(params.periodicity == 'changes') {
				that.dataListeners[name].push({
					callback: params.callback,
					ttl: params.ttl,
					token: req.header.opAccessToken
				})
			}
		})
	}

	this.verifyToken = function(token) {
		return this.secureAmqp.verifyToken(token)
	}

	this.decodeToken = function(token) {
		return this.secureAmqp.decodeToken(token)
	}

	this.createAbility = function(name, authActors, f) {
		const that = this
		function checkToken(req) {
			if(!authActors) {
				return true
			}
			const token = req.header.opAccessToken
			if(!token) {
				console.log("No token")
				return false
			}
			const decodedToken = that.secureAmqp.decodeToken(token)
			if(decodedToken.data.dst != that.id()) {
				console.log("I'm not " + decodedToken.data.dst)
				return false
			}
			if(decodedToken.data.operation != name) {
				console.log("Operation not permitted: " + name)
				return false
			}
			return that.secureAmqp.verifyToken(token)
		}
		const path = '.f.'  + name

		this.abilities[name] = {
			name: name,
			address: this.id() + path,
			public: (authActors),
			authActors: authActors || [],
			responseSchema: {}
		}

		this.secureAmqp.registerFunction(path, [checkToken], f)
	}

	this.createOperationRequestDefinition = function(actorId, name, type) {
		const that = this
		return {
			type: type,
			src: this.id(),
			dst: actorId,
			name: name,
			iat: new Date().toISOString(),
			reason: ''
		}
	}

	this.adoptChild = async function(actor) {
		const token = await this.secureAmqp.signedToken({
			parent: this.id,
			child: actor.id,
			roles: ["transitiveSignitures"]
		}, oneYear)
		const decodedToken = this.secureAmqp.decodeToken(token)
		this.children[actor.id] = actor
		actor.addParentToken(this.id(), {
			token:token,
			iat: decodedToken.iat,
			exp: decodedToken.exp
		})
		return token
	}

	this.addParentToken = function(parentId, token) {
		this.parents[parentId] = token
	}

	this.whoAreMyParents = function() {
		return this.parents
	}

	this.reactToEvent = function(event, f) {

	}
	this.reactToData = function(data, f) {

	}
	this.addAbility = function(name, f) {

	}

	this.sign = function(msg, ttl) {
		return this.secureAmqp.signedToken(msg, ttl)
	}

	this.askWhoIsOfType = function(type) {
		console.log("in ask1")
	}

	this.askWhatCanYouDo = function(id) {
		console.log("in ask2")
	}

	this.shout = function(msg) {

	}

	this.ask = function() {
		console.log("Ask")
	}

	this.promise = function() {
		console.log("promise")
	}
}


