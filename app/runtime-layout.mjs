import path from 'node:path';
export function runtimeLayout(root,env=process.env){const userRoot=env.FLIPFRAME_USER_DIR?path.resolve(env.FLIPFRAME_USER_DIR):root;return {userRoot,dataRoot:env.LAB_DATA_DIR||path.join(userRoot,'data')};}
