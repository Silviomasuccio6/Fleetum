import { REQUIRED_CI_JOBS } from '../../ci-release-identity.mjs';
export const sha = char => char.repeat(40);
export const digest = char => char.repeat(64);
export const image = (role,char) => `ghcr.io/silviomasuccio6/fleetum-${role}@sha256:${digest(char)}`;
export function fixture() {
  const repository='Silviomasuccio6/Fleetum';
  const approval={schemaVersion:1,repository,appSha:sha('a'),uiSha:sha('b'),controlSha:sha('c'),parentControlSha:sha('d'),parentRunId:'11',uiCiRunId:'12',controlCiRunId:'13',parentFrontend:image('frontend','e'),backendImage:image('backend','f'),baselineTreeSha256:digest('1'),ingressMode:'shared'};
  const context={repository,controlSha:approval.controlSha,appSha:approval.appSha,approvedUiSha:approval.uiSha,platformRunId:'21',parentRunId:approval.parentRunId};
  const run=(id,head,workflow_id=31,event='workflow_dispatch')=>({id:Number(id),head_sha:head,workflow_id,status:'completed',conclusion:'success',event,path:'.github/workflows/ci.yml',repository:{full_name:repository},head_repository:{full_name:repository}});
  const ciProof=(runId,sourceSha)=>({schemaVersion:1,repository,runId,event:'pull_request',sourceSha,checkoutSha:sourceSha,jobResults:Object.fromEntries(REQUIRED_CI_JOBS.map(k=>[k,{result:'success'}]))});
  const parent={schemaVersion:1,repository,releaseSha:approval.appSha,ciRunId:10,deployRunId:11,backendImage:approval.backendImage,frontendImage:approval.parentFrontend,completed:true,isolationPolicyVersion:1,controlSha:approval.parentControlSha};
  const proof={schemaVersion:2,kind:'platform-overlay',operation:'install',completed:true,isolationPolicyVersion:1,repository,releaseSha:approval.appSha,uiSha:approval.uiSha,controlSha:approval.controlSha,deployRunId:21,ciRunId:12,backendImage:approval.backendImage,frontendImage:image('frontend','2'),parent,uiCI:ciProof('12',approval.uiSha),controlCI:ciProof('13',approval.controlSha),manifestSha256:digest('3'),parentStaticSha256:approval.baselineTreeSha256,targetStaticSha256:digest('4'),parentWebsiteSha256:digest('5'),targetWebsiteSha256:digest('5')};
  const metadata={parent:{run:run('11',approval.parentControlSha,30),workflow:{id:30,path:'.github/workflows/deploy-staging.yml',name:'Deploy Staging'}},platform:{run:run('21',approval.controlSha),workflow:{id:31,path:'.github/workflows/deploy-platform-staging.yml',name:'Deploy Platform Staging'}},uiCI:run('12',approval.uiSha,32,'pull_request'),controlCI:run('13',approval.controlSha,32,'pull_request')};
  return {approval,context,proof,metadata};
}
