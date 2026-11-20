import {devRemoteMcp} from './mcp-dev-edge.js';

// A dedicated DEV Worker may select this entry after separate provisioning and
// deployment review. This source has no scheduler and never forwards a request.
export default {
  fetch(request, env) {
    return devRemoteMcp(request, env);
  },
};
