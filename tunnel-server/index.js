global.__root = __dirname+"/..";

global.hp = process.env.PORT || 2999;
global.wp = process.env.PORT || 2999;
global.sp = process.env.sp || 3499;


var ProxyServer = require(__dirname+"/Proxy2Client_com.js");


var proxy = new ProxyServer(hp,wp,sp);