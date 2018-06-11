# Networked-AFrame AWS IoT Adapter

Network adapter for [networked-aframe](https://github.com/haydenjameslee/networked-aframe) that uses AWS IoT message broker as a signaling layer, and WebRTC for general data communication

## Running the Example

```
git clone https://github.com/prestomation/naf-aws-iot-adapter
cd naf-aws-iot-adapter
npm install # or use yarn
# Setup AWS credentials in example/index.html
npm start
```

With the server running, browse the example at http://localhost:8080. Open another browser tab and point it to the same URL to see the other client.

## Setting Up AWS IoT

AWS IoT message broker is a pub/sub system using MQTT, and available in the browser via websockets.

Steps to setup AWS IoT:

1. [Sign up for AWS](https://aws.amazon.com/)
2. Create a Cognito Identity Pool in the cognito console(NOT a user pool)
3. Attach the 'AWSIoTDataAccess' managed policy to the unauthenticated IAM role used for the cognito identity pool
3a. Note this policy means that any client can impersonate any other client in your account. Please file an issue if you have more stringent security requirements
4. Setup the AWS JS SDK in your project like normal, using the cognito identity pool Id. the NAF adapter will automatically pickup region and cognito information


## Advanced Configuration 

You may set the `window.nafAWSIotconfig` object before instantiating NAF to override various configuration

### Credentials

It's possible to use non-Cognito credentials(please don't do this) or authenticated cognito credentials. Just setup the AWS SDK object according to these other methods. ClientIds will be randomly generated if you do not use Cognito, otherwise the Cognito clientId is used.

### Region override

You may override the IoT region with the `window.nafAWSIotconfig.region`. For example, this enables you to use Cognito in one region, but then IoT in another(incase you put clients together in their geographic region, but have a global account pool). Just set your Cognito region on the AWS SDK object and set the IoT region at `window.nafAWSIotconfig.region`

### Endpoint Override

AWS IoT provides a default message broker endpoint, which is used by default here. You may call iot:DescribeEndpoint to get your account-specific endpoint which may have higher performance. You may set this fully-qualified endpoint by setting `window.nafAWSIotconfig.endpoint`


## Known Issues

* This project has been tested in a very limited fashion! Please file bugs
* No usermedia is supported yet(audio/video chat)
* When you serve multiple application from the same AWS account and region, and a single user is using a shared Cognito ID in these applications at the same time, when they disconnect from one application they will be disconnected from all application

## Future Project Ideas:

* Option for using IoT only(no webrtc)
* Reconfigure topic hierarchy to enable better security through IAM policies
