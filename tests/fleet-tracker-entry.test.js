import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HUB_CARDS} from '../src/hub-catalog.js';

test('Fleet Tracker is the canonical tracker entry while controls remain distinct',()=>{
  const fleet=HUB_CARDS.find(card=>card.id==='fleet');
  assert.equal(fleet.name,'Fleet Tracker');
  assert.equal(fleet.appId,'fleet');
  assert.equal(fleet.audience,'grant');
  assert.equal(fleet.actions[0][0],'Open Fleet Tracker');
  assert.equal(fleet.actions[0][1],'/mission-control/analytics/');
  assert.equal(fleet.actions[1][0],'Fleet Controls');
  assert.equal(fleet.actions[1][1],'https://fleet.m-techlabs.com/');
  assert.equal(fleet.actions.some(action=>action[1]==='/mission-control/grafana/'),false);
});

test('legacy Mission Control root aliases return to tracker and Grafana route stays protected',()=>{
  const nginx=readFileSync(new URL('../integrations/hub/nginx.conf',import.meta.url),'utf8');
  assert.match(nginx,/location = \/mission-control \{ return 302 \/mission-control\/analytics\/; \}/);
  assert.match(nginx,/location = \/mission-control\/ \{ return 302 \/mission-control\/analytics\/; \}/);
  const grafana=nginx.slice(nginx.indexOf('location /mission-control/grafana/'));
  assert.match(grafana,/proxy_pass http:\/\/fleet-grafana:3000;/);
  assert.match(grafana,/proxy_set_header Host \$host;/);
  assert.match(grafana,/proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(grafana,/add_header Content-Security-Policy/);
  assert.match(grafana,/frame-ancestors 'none'/);
});

test('sanitized project export proxy is read-only, Docker-DNS resolved, and retains static fallback',()=>{
  const nginx=readFileSync(new URL('../integrations/hub/nginx.conf',import.meta.url),'utf8');
  const indexRoute=nginx.match(/location = \/mission-control\/analytics\/api\/projects \{([\s\S]*?)\n    \}/)?.[1];
  const projectRoute=nginx.match(/location ~ "\^\/mission-control\/analytics\/api\/projects\/\(\?<tracker_project>\[a-z0-9\]\[a-z0-9-\]\{0,63\}\)\$" \{([\s\S]*?)\n    \}/)?.[1];
  const staticFallback=nginx.match(/location @fleet_tracker_export_static \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(indexRoute,'exact projects index route is configured');
  assert.ok(projectRoute,'project ID route uses the slug allowlist');
  assert.ok(staticFallback,'named static fallback is configured');
  assert.match(nginx,/resolver 127\.0\.0\.11 valid=5s ipv6=off;/,'missing sidecar does not prevent nginx startup');
  for(const body of [indexRoute,projectRoute]){
    assert.match(body,/limit_except GET HEAD \{ deny all; \}/);
    assert.match(body,/proxy_pass_request_headers off;/,'client cookies and Access headers are not forwarded');
    assert.match(body,/proxy_pass_request_body off;/);
    assert.match(body,/proxy_pass \$fleet_tracker_sync_origin\$request_uri;/,'path and query reach the sidecar unchanged');
    assert.match(body,/error_page 502 504 = @fleet_tracker_export_static;/,'sidecar outage uses static fallback');
    assert.doesNotMatch(body,/add_header/,'server security headers continue to inherit');
  }
  assert.match(indexRoute,/set \$fleet_tracker_static_path \/mission-control\/analytics\/api\/projects\/index\.json;/);
  assert.match(projectRoute,/set \$fleet_tracker_static_path \/mission-control\/analytics\/api\/projects\/\$tracker_project\.json;/);
  assert.match(staticFallback,/internal;/);
  assert.match(staticFallback,/if \(\$arg_refresh = 1\) \{ return 503; \}/,'offline refresh is never reported as accepted');
  assert.match(staticFallback,/try_files \$fleet_tracker_static_path =404;/,'missing static exports remain 404');
  assert.match(nginx,/location \/ \{ try_files \$uri \$uri\/ =404; \}/,'missing exports remain 404');
  assert.doesNotMatch(nginx,/sync_requested/,'nginx never fabricates a sync acknowledgement');
});

test('repository goal estimates use the protected read-only sidecar without credentials or fake static fallback',()=>{
  const nginx=readFileSync(new URL('../integrations/hub/nginx.conf',import.meta.url),'utf8');
  const body=nginx.match(/location = \/mission-control\/analytics\/api\/repository-progress \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(body);
  assert.match(body,/limit_except GET HEAD \{ deny all; \}/);
  assert.match(body,/proxy_pass_request_headers off;/);
  assert.match(body,/proxy_pass_request_body off;/);
  assert.match(body,/proxy_pass \$fleet_tracker_sync_origin\$request_uri;/);
  assert.match(body,/proxy_read_timeout 15s;/);
  assert.doesNotMatch(body,/add_header|error_page|try_files/);
});
