'use strict';

const Assert = require('chai').assert;
const path = require('path');
const env = require('node-env-file');
const requestretry = require('requestretry');
const request = require('../support/request');
const { defineSupportCode } = require('cucumber');

/**
 * Retry until the build has finished
 * @method retryStrategy
 * @param  {Object}      err
 * @param  {Object}      response
 * @param  {Object}      body
 * @return {Boolean}     Retry the build or not
 */
function buildRetryStrategy(err, response, body) {
    return err || body.status === 'QUEUED' || body.status === 'RUNNING';
}

/**
 * Promise to wait a certain number of seconds
 * @method promiseToWait
 * @param  {Number}      timeToWait  Number of seconds to wait before continuing the chain
 * @return {Promise}
 */
function promiseToWait(timeToWait) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), timeToWait * 1000);
    });
}

/**
 * Ensure a pipeline exists, and get its jobs
 * @method ensurePipelineExists
 * @param   {Object}    config
 * @param   {String}    config.repoName     Name of the pipeline
 * @return {Promise}
 */
function ensurePipelineExists(config) {
    return this.getJwt(this.accessKey)
        .then((response) => {
            this.jwt = response.body.token;

            return request({
                uri: `${this.instance}/${this.namespace}/pipelines`,
                method: 'POST',
                auth: {
                    bearer: this.jwt
                },
                body: {
                    checkoutUrl: `git@github.com:${this.testOrg}/${config.repoName}.git#master`
                },
                json: true
            });
        })
        .then((response) => {
            Assert.oneOf(response.statusCode, [409, 201]);

            if (response.statusCode === 201) {
                this.pipelineId = response.body.id;
            } else {
                const str = response.body.message;
                const id = str.split(': ')[1];

                this.pipelineId = id;
            }

            return request({
                uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
                method: 'GET',
                json: true
            });
        })
        .then((response) => {
            Assert.equal(response.statusCode, 200);

            this.jobId = response.body[0].id;
            this.secondJobId = response.body[1].id;
            this.thirdJobId = typeof response.body[2] === 'object' ? response.body[2].id : null;
            this.lastJobId = response.body.reverse().find(b => typeof b === 'object').id
                             || null;
        });
}

/**
 * World object, exposed to tests as `this`
 * @param       {Function} attach     used for adding attachments to hooks/steps
 * @param       {Object}   parameters command line parameters
 * @constructor
 */
function CustomWorld({ attach, parameters }) {
    this.attach = attach;
    this.parameters = parameters;
    env(path.join(__dirname, '../../.func_config'), { raise: false });
    this.gitToken = process.env.GIT_TOKEN;
    this.accessKey = process.env.ACCESS_KEY;
    this.protocol = process.env.PROTOCOL || 'https';
    this.instance = `${this.protocol}://${process.env.SD_API}`;
    this.testOrg = process.env.TEST_ORG;
    this.username = process.env.TEST_USERNAME;
    this.namespace = 'v4';
    this.promiseToWait = time => promiseToWait(time);
    this.getJwt = accessKey =>
        request({
            followAllRedirects: true,
            json: true,
            method: 'GET',
            url: `${this.instance}/${this.namespace}/auth/token?access_key=${accessKey}`
        });
    this.waitForBuild = buildID =>
        requestretry({
            uri: `${this.instance}/${this.namespace}/builds/${buildID}`,
            method: 'GET',
            maxAttempts: 10,
            retryDelay: 5000,
            retryStrategy: buildRetryStrategy,
            json: true
        });
    this.loginWithToken = accessKey =>
        request({
            uri: `${this.instance}/${this.namespace}/auth/logout`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            }
        // Actual login is accomplished through getJwt
        }).then(() => this.getJwt(accessKey).then((response) => {
            this.loginResponse = response;
        }));
    this.ensurePipelineExists = ensurePipelineExists;
}

defineSupportCode(({ setWorldConstructor }) =>
    setWorldConstructor(CustomWorld));
