const SecureAmqp = require('./secureamqp.js')
const oneYear = 525949

module.exports = function Actor(config) {
	
	this.secureAmqp = new SecureAmqp(config)
	this.parents = {}
	this.children = {}
	this.abilities = {}
	this.events = {}
    this.data = {}
	this.trust = {
		
	}
	this.type = config.type || "None"


	this.boot = async function() {
		await this.secureAmqp.init(config)
	}

	this.addTrustedActor = function(id, abilities, data, events) {
		this.trust[id] = {
			abilities: abilities || [],
			data: data || [],
			events: events || []
		}
	}
	
	this.id = function() {
		return this.secureAmqp.getMyAddress()
	}

	this.actor = function(actorId) {
		const that = this
		return {
			call: function(name, opToken, params) {
				const headers = {
					opAccessToken: opToken
				}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.f.' + name, params, null, headers, function(res) {
						resolve(res.msg.response)
					})
				})
			},
			sign: function(op) {
				const headers = {}
				return new Promise(function(resolve,reject) {
					that.secureAmqp.callFunction(actorId, '.f.sign', op, null, headers, function(res) {
						resolve(res.msg.response)
					})
				})

			}
		}
	}


	this.createAbility = function(name, public, f) {
		function checkToken(req) {
			console.log(req)
			const token = req.header.opAccessToken
			if(!token) {
				return false
			}
			console.log("OpToken: ", token)
			return true
		}
		const path = '.f.'  + name

		if(!public) {
			this.secureAmqp.registerFunction(path, [checkToken], f)
		} else {
			this.secureAmqp.registerFunction(path, [], f)
		}
	}

	this.verifyOpToken = function(token) {

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

	this.sign = function(msg) {
		return this.secureAmqp.signedToken(msg)
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


