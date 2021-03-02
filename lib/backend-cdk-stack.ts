import * as cdk from '@aws-cdk/core';
import * as appsync from '@aws-cdk/aws-appsync';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as events from '@aws-cdk/aws-events';
import * as eventsTargets from '@aws-cdk/aws-events-targets';
import * as lambda from '@aws-cdk/aws-lambda';
import { requestTemplate, responseTemplate, EVENT_SOURCE } from '../utils/appsync-request-responce';
import * as s3 from '@aws-cdk/aws-s3';
import * as cloudfront from '@aws-cdk/aws-cloudfront'
import * as origins from '@aws-cdk/aws-cloudfront-origins'
import * as s3deploy from '@aws-cdk/aws-s3-deployment';





export class BackendCdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
     const api = new appsync.GraphqlApi(this, "Api", {
      name: "project14aEventbridgeAPI",
      schema: appsync.Schema.fromAsset("utils/schema.gql"),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY,     ///Defining Authorization Type
          apiKeyConfig: {
            expires: cdk.Expiration.after(cdk.Duration.days(365))   ///set expiration for API Key
          }
        },
      },
     
      xrayEnabled: true,
    });
    const todoTableEvent = new dynamodb.Table(this, 'todoAppEvent', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
    });
    const todoTable = api.addDynamoDbDataSource('todoAppTable', todoTableEvent);

    const httpEventTriggerDS = api.addHttpDataSource(
      "eventTriggerDS",
      "https://events." + this.region + ".amazonaws.com/", // This is the ENDPOINT for eventbridge.
      {
        name: "httpDsWithEventBridge",
        description: "From Appsync to Eventbridge",
        authorizationConfig: {
          signingRegion: this.region,
          signingServiceName: "events",
        },
      }
    );
    events.EventBus.grantPutEvents(httpEventTriggerDS);

    todoTable.createResolver({
      typeName: "Query",
      fieldName: "getTodos",
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbScanTable(),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList(),
    });
    const mutations = ["addTodo","deleteTodo"]
   
    mutations.forEach((mut) => {
      let details = `\\\"id\\\": \\\"$ctx.args.id\\\"`;

      if (mut === 'addTodo') {
        details = `\\\"task\\\":\\\"$ctx.args.todo.task\\\", \\\"done\\\":\\\"$ctx.args.todo.done\\\"`
      } 
  
    httpEventTriggerDS.createResolver({
      typeName: "Mutation",
      fieldName: mut,
      requestMappingTemplate: appsync.MappingTemplate.fromString(requestTemplate(details, mut)),
      responseMappingTemplate: appsync.MappingTemplate.fromString(responseTemplate()),
    });
  });
  const dynamoHandlerLambda = new lambda.Function(this, 'Dynamo_Handler', {
    code: lambda.Code.fromAsset('lambda'),
    runtime: lambda.Runtime.NODEJS_12_X,
    handler: 'dynamoHandler.handler',
    environment: {
      DYNAMO_TABLE_NAME:  todoTableEvent .tableName,
    },
    timeout: cdk.Duration.seconds(10)
  });
  // Giving Table access to dynamoHandlerLambda
  todoTableEvent .grantReadWriteData(dynamoHandlerLambda);

      new events.Rule(this, "TodoTableRule", {
        targets:[new eventsTargets.LambdaFunction(dynamoHandlerLambda)],
        eventPattern: {
          source: [EVENT_SOURCE],
          detailType: [...mutations,],
        },
       
      });

      const webBucket:any = new s3.Bucket(this, "WebsiteBucket", {
        publicReadAccess: true,
        websiteIndexDocument: "index.html",
        versioned: true,
      });
  
    
  
      const distribution = new cloudfront.Distribution(
        this,
        "CloudDistribution",
        {
          defaultBehavior: { origin: new origins.S3Origin(webBucket) },
        }
      );
  
     
      const webDeployment = new s3deploy.BucketDeployment(this, "todoApp", {
        sources: [s3deploy.Source.asset("../frontend/todo-app/public")],
        destinationBucket: webBucket,
        distribution: distribution,
      });

      new cdk.CfnOutput(this, 'Graphql_Endpoint', {
        value: api.graphqlUrl
      });
      new cdk.CfnOutput(this, "DistributionDomainName", {
        value: distribution.domainName,
      });
      new cdk.CfnOutput(this, "GraphQLAPIKEY", {
        value: api.apiKey || "",
      });
  
      new cdk.CfnOutput(this, "RegionName", {
        value: this.region,
      });
  }
}
