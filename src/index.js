const WebRtcPeer = require("./WebRtcPeer");
const mqtt = require('mqtt')

class AWSIotWebRtcAdapter {
  /**
    Config structure:
    config.AWS: The AWS SDK object;
    config.endpointPrefix: Your IoT Endpoint Prefix. something like `b2n01xrb17urak`;
    config.region: The AWS region you would like to use, defaults to the region configured on the AWS object, or us-east-1 as last resort;
    config.client: The clientId for this user. Defaults to the CognitoId(if using cognito), or a random uuid
  */
  constructor(config) {
    this.rootPath = "networked-aframe";
    this.config = config || {};

    this.config = config || window.nafAWSIotconfig || {};
    this.AWS = this.config.AWS || window.AWS;
    if (this.AWS === undefined) {
      throw new Error(
        "No AWS SDK in config!"
      );
    }

    this.config.endpointPrefix = this.config.endpointPrefix || "data";
    this.config.region = this.config.region || AWS.config.region || "us-east-1";

    this.localId = null;
    this.appId = null;
    this.roomId = null;

    this.peers = {}; // id -> WebRtcPeer
    this.occupants = {}; // id -> joinTimestamp
    this.topicListeners = {};  // topic -> fn

    this.config.endpoint = this.config.endpoint || `https://${this.config.endpointPrefix}.iot.${this.config.region}.amazonaws.com`;

  }

  /*
   * Call before `connect`
   */

  setServerUrl(url) {
    // handled in config
  }

  setApp(appId) {
    this.appId = appId;
  }

  setRoom(roomId) {
    this.roomId = roomId;
  }

  getMediaStream(clientId) {
    //Not yet implemented
    return Promise.reject("Interface method not implemented: getMediaStream")
  }

  // options: { datachannel: bool, audio: bool }
  setWebRtcOptions(options) {
    // TODO: support audio and video
    if (options.datachannel === false)
      console.warn(
        "AWSIotWebRtcAdapter.setWebRtcOptions: datachannel must be true."
      );
    if (options.audio === true)
      console.warn("AWSIotWebRtcAdapter does not support audio yet.");
    if (options.video === true)
      console.warn("AWSIotWebRtcAdapter does not support video yet.");
  }

  setServerConnectListeners(successListener, failureListener) {
    this.connectSuccess = successListener;
    this.connectFailure = failureListener;
  }

  setRoomOccupantListener(occupantListener) {
    this.occupantListener = occupantListener;
  }

  setDataChannelListeners(openListener, closedListener, messageListener) {
    this.openListener = openListener;
    this.closedListener = closedListener;
    this.messageListener = function (remoteId, dataType, data) {
      messageListener(remoteId, dataType, data);
    };
  }

  connect() {
    this.initIoT(() => {

      this._subscribeToIoTTopic(this.getRoomPath(), (payload) => {

        const remoteId = payload.clientId;
        const remoteTimestamp = payload.timestamp;

        // Don't connect to ourselves or someone we've already connected to
        if (
          remoteId === this.localId ||
          //((this.peers[remoteId] !== undefined && this.peers[remoteId].getStatus() !== WebRtcPeer.NOT_CONNECTED)
          ((this.peers[remoteId] !== undefined)
        ))
         {
          return;
         }

        const peer = new WebRtcPeer(
          this.localId,
          remoteId,
          // send signal function
          (data) => this._publishIoTMessage(this.getSignalPath(this.localId), data)
        );
        peer.setDatachannelListeners(
          this.openListener,
          this.closedListener,
          this.messageListener
        );

        this.peers[remoteId] = peer;
        this.occupants[remoteId] = remoteTimestamp;

        this._subscribeToIoTTopic(this.getSignalPath(remoteId), data => {
          if (data === null || data === "") return;
          peer.handleSignal(data);
        });

        this._subscribeToIoTTopic(this.getDataPath(remoteId), data => {

          if (data === null || data === "" || data.to !== this.localId)
            return;
          this.messageListener(remoteId, data.type, data.data);
        });

        this._subscribeToIoTTopic(this.getClientDisconnectedTopic(remoteId), data => {
          // We will learn when this clientId disconnects from anywhere in this AWS account
          // This means that the same clientId cannot be used concurrently by two different
          // 'rooms' or 'apps'.(if a user disconnect from one, all peers in all apps will disconnect them)
          if (
            remoteId === this.localId ||
            this.peers[remoteId] === undefined
          )
            return;
          delete this.peers[remoteId];
          delete this.occupants[remoteId];

          this.occupantListener(this.occupants);

        });

        // send offer from a peer who
        //  - later joined the room, or
        //   - has larger id if two peers joined the room at same time
        if (
          this.localTimestamp > remoteTimestamp ||
          (this.localTimestamp === remoteTimestamp && self.localId > remoteId)
        )
          peer.offer();

        this.occupantListener(this.occupants);
        const connectionMsg = {
          clientId: this.localId,
          timestamp: this.localTimestamp
        }
        this._publishIoTMessage(this.getRoomPath(), connectionMsg);
      });

      const connectionMsg = {
        clientId: this.localId,
        timestamp: this.localTimestamp
      }
      this._publishIoTMessage(this.getRoomPath(), connectionMsg);


      this.connectSuccess(this.localId);
    });
  }

  shouldStartConnectionTo(client) {
    return (this.myRoomJoinTime || 0) <= (client ? client.roomJoinTime : 0);
  }

  startStreamConnection(clientId) {
    // Handled by WebRtcPeer
  }

  closeStreamConnection(clientId) {
    // Handled by WebRtcPeer
  }

  sendData(clientId, dataType, data) {
    this.peers[clientId].send(dataType, data);
  }

  sendDataGuaranteed(clientId, dataType, data) {
    const clonedData = JSON.parse(JSON.stringify({
      to: clientId,
      type: dataType,
      data: data
    }));
    this._publishIoTMessage(this.getDataPath(this.localId), clonedData);
  }

  broadcastData(dataType, data) {
    for (const clientId in this.peers) {
      if (this.peers.hasOwnProperty(clientId)) {
        this.sendData(clientId, dataType, data);
      }
    }
  }

  broadcastDataGuaranteed(dataType, data) {
    for (const clientId in this.peers) {
      if (this.peers.hasOwnProperty(clientId)) {
        this.sendDataGuaranteed(clientId, dataType, data);
      }
    }
  }

  getConnectStatus(clientId) {
    const peer = this.peers[clientId];

    if (peer === undefined) return NAF.adapters.NOT_CONNECTED;

    switch (peer.getStatus()) {
      case WebRtcPeer.IS_CONNECTED:
        return NAF.adapters.IS_CONNECTED;

      case WebRtcPeer.CONNECTING:
        return NAF.adapters.CONNECTING;

      case WebRtcPeer.NOT_CONNECTED:
      default:
        return NAF.adapters.NOT_CONNECTED;
    }
  }

  /*
   * Privates
   */

  getClientId() {
    if (this.config.clientId) {
      return this.config.clientId;
    }
    if (this.AWS.config.credentials instanceof this.AWS.CognitoIdentityCredentials) {
      return this.AWS.config.credentials.identityId;
    }
    return this.randomString();
  }

  _presignIOTMQTTConnection(endpoint, credentials) {
    // Incredibly hacky piece of code to sign our websocket URL
    // because the AWS SDK doesn't do this out of the box
    var service = new this.AWS.IotData({ endpoint: endpoint, credentials: credentials, paramValidation: false });

    service.api.signingName = "iotdevicegateway";

    //1. Create a request object for another, sorta similar request
    //2. Save off our session token and delete it from the credentials(so it doesn't get signed)
    //3. Register to an event in the state machine to adjust the path
    //4. Sign it!
    //5. Restore session token, and add it to the url
    var req = service.getThingShadow({});
    var sessionToken = service.config.credentials.sessionToken;
    delete req.service.config.credentials.sessionToken;
    req.on("afterBuild", function (data) { data.httpRequest.path = "/mqtt"; });
    var url = req.presign().replace("https:", "wss:");
    req.service.config.credentials.sessionToken = sessionToken;
    url += "&X-Amz-Security-Token=" + encodeURIComponent(credentials.sessionToken);
    return url;
  };

  initIoT(callback) {
    // Let's ensure we have credentials before we hit up IoT
    this.AWS.config.credentials.refresh(() => {

      //If a region override was set, let's set it here.
      // This allows clients to use IoT and Cognito in different regions
      // by setting the cognito region on the AWS object, but set the IoT
      // region in our configp
      this.AWS.config.update({region : this.config.region});
      const signedWSS = this._presignIOTMQTTConnection(this.config.endpoint, this.AWS.config.credentials);
      this.localId = this.getClientId();
      this.localTimestamp = NAF.utils.now();

      this.wss = new mqtt.connect(signedWSS, { clientId: this.localId });

      this.wss.on('connect', callback);
      this.wss.on('message', (topic, msg) => this._onIoTMessageArrived(topic, msg));
    });
  }
  _subscribeToIoTTopic(topicName, callback) {
    this.topicListeners[topicName] = callback;
    this.wss.subscribe(topicName);
  }

  _onIoTMessageArrived(topic, msg) {

    if (!this.topicListeners[topic]) {
      return console.warn(`Could not find listener for ${this.topic}`)
    }
    const payload = JSON.parse(msg.toString());
    this.topicListeners[topic](payload);
  }

  _publishIoTMessage(topic, payload) {
    this.wss.publish(topic, JSON.stringify(payload));
  }

  getRootPath() {
    return this.rootPath;
  }

  getAppPath() {
    return this.getRootPath() + "/" + this.appId;
  }

  getRoomPath() {
    return this.getAppPath() + "/" + this.roomId;
  }

  getUserPath(id) {
    return this.getRoomPath() + "/" + id;
  }

  getSignalPath(id) {
    return this.getUserPath(id) + "/signal";
  }

  getDataPath(id) {
    return this.getUserPath(id) + "/data";
  }

  getClientDisconnectedTopic(clientId) {
    return "$aws/events/subscriptions/unsubscribed/" + clientId;
  }


  randomString() {
    const stringLength = 16;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz0123456789";
    let string = "";

    for (let i = 0; i < stringLength; i++) {
      const randomNumber = Math.floor(Math.random() * chars.length);
      string += chars.substring(randomNumber, randomNumber + 1);
    }

    return string;
  }
}

NAF.adapters.register("awsiot", AWSIotWebRtcAdapter);

module.exports = AWSIotWebRtcAdapter;
