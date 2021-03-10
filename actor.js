const SecureAmqp = require('./secureamqp.js')
const oneYear = 525949

module.exports = function Actor(config) {
	
	this.secureAmqp = new SecureAmqp(config)
	this.parents = {}
	this.children = {}
	this.abilities = {}
	this.events = {}
    this.data = {}
	this.friends = {}
	this.type = config.type || "None"


	this.boot = async function() {
		await this.secureAmqp.init(config)
	}

	this.createOperationRequestDefinition = function(actorId, name, type) {
		return {
			type: type,
			src: this.id,
			dst: actorId,
			name: name,
			iat: new Date().toISOString(),
			reason: ''
		}
	}

	this.requestOperationSignature = function(actorId, op) {
		const that = this
		return new Promise(function(resolve,reject) {
			that.secureAmqp.callFunction(actorId, 'sign', op, null, function(res) {
					console.log("Fucntion: " + fname + " returned.") 
				resolve(res.msg)
			})
		})

	}

	this.id = function() {
		return this.secureAmqp.getMyAddress()
	}

	this.biLateralLink = function(actorId) {

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


