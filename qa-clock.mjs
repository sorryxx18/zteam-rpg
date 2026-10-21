// Opt-in QA speed is local-only; never replace any global clock or round rule.
export function localTestRate(location){
  const loopback=['localhost','127.0.0.1','[::1]','::1'].includes(location.hostname);
  return loopback&&new URLSearchParams(location.search).get('test')==='1'?5:1;
}
