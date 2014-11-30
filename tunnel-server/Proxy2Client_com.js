/*
  1) Server boots up waiting for connections
  2) A user connects its local machine to the server
  3) The Server Stores who to talk to
  4) The Server gives the local machine a url/authentication its available on


  1) A user connects to the server on a seperate connection
  2) The user goes to specified url/authenticates
  3) Server Sends all messages to local machine sent from user
  4) Server sends all messages to user sent from local machine

  Server never touches routing except for...
  1) Allowing a machine to connect to it
  2) Allowing a user to specify that is the machine it wants to talk to

*/

var net = require("net");
var MessageProxy = require(__root+"/abstract/MessageProxyClientSlave.js");;
var http = require("http");
var WebSocketServer = require('ws').Server;
var url = require("url");
var fs = require("fs");
var querystring = require("querystring");

function ProxyServer(httpport,websocketport,serversocketport){
  this.ws = {};
  var that = this;
  MessageProxy.call(this,function(message,ws){
    that.ws[message.id].send(JSON.stringify(message));
  },function(message,con){
    con.write(JSON.stringify(message)+"\u00B6")
  })
  this.locals = {};
  this.users = {};
  this.wss = new WebSocketServer({
    port: websocketport,
    verifyClient:function(info){
      var cook = parseCookies(info.req);
      console.log("cook? " + JSON.stringify(cook));
      return !!cook.client
    }
  });

  this.wss.handleUpgrade = function(req, socket, head, next){
    WebSocketServer.prototype.handleUpgrade.call(that.wss,req,socket,head,function(ws){
      var cook = parseCookies(req);
      ws.id = cook.client;
      console.log("handled: " + cook);
      next(ws);
    })
  };


  console.log("web socket is at: " + this.wss.options.host + ":" + this.wss.options.port);


  // Create an HTTP tunneling proxy
  this.http = http.createServer(this.httpReq.bind(this));

  this.http.listen(httpport);

  this.wss.on('connection', function (ws) {

    ws.on('close',function(){
      console.log("disconnect");
      /*
      that.clientMessage({
        id: Date.now() + "-" + Math.random(),
        client: ws.id,
        protocol: "ws",
        type:"trigger",
        name:"user:disconnect",
        data: ws.id
      },ws);
      */
    })
    ws.on('message', function (message) {
      console.log(ws.id);
      try{
        message = JSON.parse(message);
      }catch(e){
        return ws.close();
      }
      message.protocol = "ws";
      that.ws[message.id] = ws;
      that.clientMessage(message,ws);
    });
  });

  this.server = net.createServer({allowHalfOpen: true},function(c){
    c.on("data",function(data){
      if(data.length > 100)
        return c.destroy();
      data = data.toString("utf-8");
      c.removeAllListeners("data");
      if(data == "new"){
        that.slaveEnter(c);
        c._p2cbuffer = "";
        c.on('end', function() {
          that.slaveLeave(c);
        });
        socketWrapper(c,function(m){
          try{
            m = JSON.parse(m);
            that.handleSocketMessage(m,c);
          }catch(e){
            console.log(e.stack)
            c.destroy();
          }
        })
      }else if(/^http\:/.test(data)){
        data = data.substring(5);
        that.clients[data].sq.shift()(c);
      }
    });
  });
  this.server.listen(serversocketport, function() { //'listening' listener
    console.log('server bound to'+serversocketport);
  });
}
ProxyServer.prototype = Object.create(MessageProxy.prototype);
ProxyServer.prototype.constructor = ProxyServer;

ProxyServer.prototype.handleSocketMessage = function(message,c){
  if(message.name == "auth"){
    if(message.data === "ok"){
      console.log("client ok "+message.client);
      message.data = message.client;
      this.clients[message.client].res.writeHead(200,{
       'Set-Cookie': 'client='+message.client+"; websocketport="+wp+"; path=/; expires=01 Jan 2020 00:00:00 GMT;"
      });
      var fileStream = fs.createReadStream(__dirname+"/public/redirect.html");
      fileStream.pipe(this.clients[message.client].res);
      return;
    }else{
      this.clients[message.client].res.writeHead(302,{
       'Location': '/'
      });
    }
    this.clients[message.client].res.end();
    return;
  }
  this.slaveMessage(message,c);
}

ProxyServer.prototype.httpReq = function (req, res) {
  var that = this;
  if(this.shield(req,res))
    return;
  var u = url.parse(req.url);
  var clientid =  parseCookies(req).client;
  var header = "";
  this.requestSocket(clientid,function(httpsocket){
    httpsocket.write(JSON.stringify({
      path:u.path,
      method: req.method,
      headers: req.headers
    })+'\u00B6');
    req.pipe(httpsocket);
    httpsocket.on("data",function(data){
      temp = data.toString("utf-8");
      var i = temp.indexOf('\u00B6');
      if(i == -1){
        header += temp;
        return;
      }
      httpsocket.removeAllListeners("data");
      header += temp.substring(0,i);
      temp = new Buffer(temp.substring(0,i+1));
      data = data.slice(temp.length);
      header = JSON.parse(header);
      header.port = that.httpport;
      res.writeHead(header.statusCode, header.headers);
      res.write(data);
      httpsocket.pipe(res)
    })
  })
};

ProxyServer.prototype.requestSocket = function(clientid,cb){
  this.slaveSend({name:"socketrequest",client:clientid},this.clients[clientid].slave);
  this.clients[clientid].sq.push(cb);
}


ProxyServer.prototype.shield = function(req,res){
  var that = this;
  var cook = parseCookies(req);
  var u = url.parse(req.url);
  if(u.pathname === "/exit"){
    res.writeHead(302, {
      'Location': '/',
      "Set-Cookie": "client=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;"

      //add other headers here...
    });
    res.end();
    return true;
  }
  var headers = {};
  if(cook.client){
    if(!(cook.client in this.clients)){
      headers["Set-Cookie"]= "client=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;";
      delete cook.client;
    }else{
      return;
    }
  }

  if(u.pathname === "/auth" && req.method.toLowerCase() == "post"){
    var pass = "";
    req.on("data",function(data){
      pass += data;
    });
    req.on('end', function() {
      pass = querystring.parse(pass);
      if(!pass.name){
        headers.Location = "/";
        res.writeHead(302, headers);
        res.end();
        return true;
      }
      var m = {
        id: Date.now()+"|"+Math.random(),
        name: "auth",
        data: {
          name: pass.name
        }
      };
      that.clientEnter(res);
      that.bindClient({id:pass.name},res);
      m.data={pass: pass.pass};
      that.clientMessage(m,res)
    });
    return true;
  }
  if(!/^\/?$/.test(u.pathname)){
    headers.Location = "/";
    res.writeHead(302, headers);
    res.end();
  }
  headers["Content-Type"] = "text/html";
  res.writeHead("200",headers);
  var fileStream = fs.createReadStream(__dirname+"/public/index.html");
  fileStream.pipe(res);
  return true;
}

function parseCookies (request) {
    var list = {},
        rc = request.headers.cookie;

    rc && rc.split(';').forEach(function( cookie ) {
        var parts = cookie.split('=');
        list[parts.shift().trim()] = unescape(parts.join('='));
    });

    return list;
}



function socketWrapper(socket,cb){
  socket.___buffer = "";
  socket.on('data', function(data) {
    socket.___buffer += data.toString("utf-8");
    var d_index = socket.___buffer.indexOf('\u00B6'); // Find the delimiter
    while (d_index > -1) {
      data = socket.___buffer.substring(0,d_index); // Create string up until the delimiter
      cb(data);
      socket.___buffer = socket.___buffer.substring(d_index+1);
      d_index = socket.___buffer.indexOf('\u00B6');
    }
  });
}


module.exports = ProxyServer;

