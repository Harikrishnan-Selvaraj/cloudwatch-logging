# cloudwatch-logging

A simple Asynchronous cloud watch logging mechanism with an extended Console logger.
This package is based on reference from [aws4](https://www.npmjs.com/package/aws4) and [winston logger](https://www.npmjs.com/package/winston)

## Table of Contents
1. [How to install?](#how-to-install?)
2. [Using Logger](#using-logger)

### How to install?
```npm install cloudwatch-logging --save```

### Using logger
You can import logger with default configuration that will log in your server console.

```
const { logger } = require('cloudwatch-logging')
logger.info('This is a info message from logger')
```

**Note:** Logger level is set to `info` by default, you can update the level by updating the logger config.

### Configuration
 You can modify the available list of configuration at any point of time that will update the logger config across the whole application  
 
##### Configurations available:  
 1. `level`
    * `error, warn, info, verbose, debug`      
 2. `isLocal`
    * `true: logger will logged over the local console (server terminal)`
    * `false: will log in both AWS cloudwatch as well as server terminal`  
     
    **Note:** if set to `false` below configuration details are manditory`
 3. `logGroupName`
    * `Cloudwatch log groupname: string`
 4. `logStreamName`
    * `Cloudwatch log streamname: string`
 5. `region`
    * `AWS region: string`
 6. `accessKeyId`
    * `AWS access key ID: string`
 7. `secretAccessKey`
    * `AWS secret key: string`
 8. `uploadRate`
    * `Time interval at which the logs are uploaded into cloudwatch: number`
 9. `retentionInDays`
    * `Time duration in days at which the logs are saved in cloudwatch: number`
 10. `retryCount`  
    * `Number of retries required if the AWS cloudwatch server is unreachable: number`
    
##### Updating config
You can update the logger config by using one the below mentioned ways:

```
const { config } = require('cloudwatch-logging');
config({
    level: 'debug',
    isLocal: true
});
``` 
or

```
const cloudWatchLogger = require('cloudwatch-logging');
cloudWatchLogger.config({
    level: 'debug',
    isLocal: true
});
```
