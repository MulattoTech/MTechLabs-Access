const paths=[
  'https://mcp.m-techlabs.com/.well-known/oauth-authorization-server',
  'https://mcp.m-techlabs.com/.well-known/oauth-protected-resource',
  'https://mcp.m-techlabs.com/mcp',
  'https://mcp-origin.m-techlabs.com/v1/status',
  'https://m-techlabs.com/admin/mcp',
  'https://codes.m-techlabs.com/health',
  'https://m-techlabs.com/admin/access',
  'https://m-techlabs.com/admin/mcp/api/status',
  'https://m-techlabs.com/admin/mcp/assets/mcp.js',
  'https://www.m-techlabs.com/admin/mcp',
  'https://mcp-origin.m-techlabs.com/mcp',
];
for(const url of paths){
  try{
    const response=await fetch(url,{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    const row={url,status:response.status,contentType:response.headers.get('content-type'),challenge:response.headers.get('www-authenticate')};
    if(url.includes('/.well-known/')&&response.status===200){
      const body=await response.json();
      for(const key of ['issuer','resource','authorization_servers','authorization_endpoint','token_endpoint','registration_endpoint','code_challenge_methods_supported','grant_types_supported','authorization_response_iss_parameter_supported'])if(key in body)row[key]=body[key];
    }else if(url==='https://codes.m-techlabs.com/health'&&response.status===200){
      const body=await response.json();row.healthy=body.ok===true;row.service=body.service;
      if(!row.healthy)process.exitCode=1;
    }else await response.body?.cancel();
    const expected=url.includes('/.well-known/')||url.endsWith('/health')?[200]:url.includes('/admin/')?[301,302,303]:[401];
    row.expectedStatus=expected.includes(response.status);if(!row.expectedStatus)process.exitCode=1;
    console.log(JSON.stringify(row));
  }catch(error){console.log(JSON.stringify({url,error:error.message}));process.exitCode=1;}
}
