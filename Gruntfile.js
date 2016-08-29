'use strict';

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    node_version: {
      options: {

      }
    },
    lambda_invoke: {
      default: {
        options: {
          event: 'test/event.json'
        }
      }
    },
    lambda_package: {
      default: {
        options: {
          // Task-specific options go here.
        }
      }
    },
    lambda_deploy: {
      default: {
        arn: 'arn:aws:lambda:us-east-1:748801462010:function:pagerduty-alexa-skill',
        options: {
          // Task-specific options go here.
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-aws-lambda');

  grunt.loadNpmTasks('grunt-node-version');

  grunt.registerTask('default', ['invoke']);
  grunt.registerTask('invoke', ['node_version', 'lambda_invoke']);
  grunt.registerTask('deploy', ['node_version', 'lambda_package', 'lambda_deploy']);
};
