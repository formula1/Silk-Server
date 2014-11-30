global.__root = __dirname+"/..";

global.hp = process.env.hp || 2999;
global.wp = process.env.wp || 9998;
global.sp = process.env.sp || 3499;


var ProxyServer = require(__dirname+"/Proxy2Client_com.js");


var proxy = new ProxyServer(hp,wp,sp);

