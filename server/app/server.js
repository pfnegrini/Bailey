// sudo udevadm control --reload-rules
// to refresh the port allocation
// cd /home/pi/Bailey/server/app

var nconf = require('nconf');
nconf.argv()
       .env()
       .file({ file: __dirname + '/config.json' });

var events = require('events');
var eventEmitter = new events.EventEmitter();
var nodeLib = nconf.get('server:nodeLib');
var logfilePath = nconf.get('server:logfilePath');

var telemetryfilePath = nconf.get('telemetry:telemetryfilePath');
var bunyan = require('bunyan');

//--------------- Logging middleware ---------------
var log = bunyan.createLogger({
  name: 'Bailey',
  streams: [
    /*{
      level: 'debug',
      stream: process.stdout            // log INFO and above to stdout
    },*/
    //Log should be outside app folders
    {
      path: logfilePath + 'Baileylog.log'  // log ERROR and above to a file
    }
  ]
});

var fs = require('safefs');
var SEPARATOR = nconf.get('telemetry:SEPARATOR');
var installPath = nconf.get('server:installPath');
var com = require('serialport');
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var sys = require('sys');
var exec = require('child_process').exec;

var serPort = nconf.get('server:serPort');
var serBaud = nconf.get('server:serBaud');
var serverPort = nconf.get('server:serverPort');
var version = nconf.get('server:version');
var videoFeedPort = nconf.get('MJPG:MJPGPort');
var videoWidth = nconf.get('video:videoWidth');
var videoHeight = nconf.get('video:videoHeight');
var fps= nconf.get('video:fps');

// include custom functions ======================================================================
var systemModules = require(__dirname + '/lib/systemModules');
var functions = require(__dirname + '/lib/functions');
var camera = require(__dirname + '/lib/camera');
//var robot = require(__dirname + 'server/app/robot');
var videoFeed = require(__dirname + '/lib/video');

var path = require('path'); 
app.use(express.static((__dirname + '/../wwwroot')));
//console.log((__dirname + '/../wwwroot'));
// load the routes
require('./routes')(app);


//Not nice, implement asciimo: https://github.com/Marak/asciimo
function greetings() {

 
}

var serverADDR = 'N/A';
var LogR = 0;
var TelemetryFN = 'N/A';
var prevTel="";
var prevPitch="";
var THReceived=0;

var TelemetryHeader = 'N/A';
var PIDHeader ='N/A';
var ArduSysHeader;
var Telemetry ={};
var PID ={};
var PIDVal;
var ArduSys = {};

/*
 Can use a try... catch statement
 var SerialPort = require("serialport").SerialPort

try {
  var serialPort = new SerialPort("/dev/portdoesntexist");
} catch(error) {
  console.log("Port not ready/doesn't exist!");
}
*/ 

var serialPort = new com.SerialPort(serPort, {
  baudrate: serBaud,
  parser: com.parsers.readline('\n')
  });
  

serialPort.on('open',function() {
  console.log('Arduino connected on '+ serPort + ' @' + serBaud);
  
    
  
});


//Get IP address http://stackoverflow.com/questions/3653065/get-local-ip-address-in-node-js

var os = require('os');
var ifaces = os.networkInterfaces();

Object.keys(ifaces).forEach(function (ifname) {
  var alias = 0
    ;

  ifaces[ifname].forEach(function (iface) {
    if ('IPv4' !== iface.family || iface.internal !== false) {
      // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
      return;
    }

    if (alias >= 1) {
      // this single interface has multiple ipv4 addresses
      console.log(ifname + ':' + alias, iface.address);
    } else {
      // this interface has only one ipv4 adress
      serverADDR = iface.address;
    }
  });
});

//---------------

io.on('connection', function(socket){
  //socket.emit('connected', version, Telemetry);  
   
    var myDate = new Date();
   
  
   var startMessage = 'Connected ' + myDate.getHours() + ':' + myDate.getMinutes() + ':' + myDate.getSeconds()+ ' v' + version + ' @' + serverADDR;
  //Init the heades for telemtry data
  serialPort.write('READ RemoteInit\n\r');
    //Trasmit system and PID parameters
   
    //socket.emit('serverADDR', serverADDR);
    socket.emit('connected', startMessage, serverADDR, serverPort, videoFeedPort, PIDHeader, PID);
    console.log('New socket.io connection - id: %s', socket.id);
    
    //Add also the disconnection event
    log.info('Client connected ' + socket.id);
   
    setTimeout(function() {
        videoFeed.startVideoFeed(socket, videoWidth, videoHeight, fps); 
    }, 2000);
    
    
  setInterval(function(){
  if(THReceived==1)socket.emit('status', Telemetry['yaw'], Telemetry['pitch'], Telemetry['roll'], Telemetry['bal'], Telemetry['dISTE']);
  if(Telemetry['pitch'] > 60)log.error('BALANCING FAIL! Pitch: ' + Telemetry['pitch']);            
  }, 250);

  
  setInterval(function(){

  var usage = "N/A";
  var temperature = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp");
temperature = ((temperature/1000).toPrecision(3)) + "°C";

  socket.emit("CPUInfo", temperature, usage);
  }, 3 * 1000);
 
  socket.on('Video', function(Video){
   socket.emit('CMD', Video);
    function puts(error, stdout, stderr) { sys.puts(stdout) }
    exec('sudo bash ' + installPath + 'server/app/bin/' + Video, puts);
        
    });

  //Set commands goes to Arduino directly
    socket.on('SCMD', function(CMD){
    serialPort.write('SCMD ' + CMD + '\n');
    log.debug('Command SCMD ' + CMD);
    });
  
    socket.on('move', function(dX, dY){
	//console.log('event: ', dX, dY);
	serialPort.write('SCMD Steer ' + Math.round(dX) + '\n');
	serialPort.write('SCMD Throttle ' + Math.round(dY) + '\n');
	//log.debug('Move command SCMD ' + CMD);
	});
    
  //Server Commands
  socket.on('SerCMD', function(CMD){  
    socket.emit('CMD', CMD);    
    if ( CMD == "LOG_ON" && !LogR) {
      TelemetryFN = 'Telemetry_' + systemModules.timeStamp() + '.csv'; 
      socket.emit('Info', telemetryfilePath+TelemetryFN)
      log.debug('Telemetry logging started ' + telemetryfilePath + TelemetryFN);
      
      systemModules.setTelemetryFile(telemetryfilePath, TelemetryFN, TelemetryHeader, PIDHeader, SEPARATOR);
       LogR = 1;
        
    }
    else if ( CMD == "LOG_OFF" ){
	//console.log("Log Stopped");
	socket.emit('Info', "logging stopped");     
	LogR = 0;
	log.debug('Telemetry logging stopped ' + telemetryfilePath+TelemetryFN);
    }
    else if ( CMD == "showConfig" ){
        fs.readFile(__dirname + '/config.json', 'utf8', function (err, json) {
        if (err) throw err;        
	socket.emit('configSent', json);            
        });
    }
  });

  socket.on('REBOOT', function(){
    function puts(error, stdout, stderr) { sys.puts(stdout) }
    log.info('Server rebootiing now');
    exec('sudo reboot now');
    sockets.emit('Info', "Rebooting")

  });

  socket.on('SHUTDOWN', function(){
    socket.emit('Info', "Bailey going down for maintenance now!");
    log.info('Bailey going down for maintenance now!');
    function puts(error, stdout, stderr) { sys.puts(stdout) }
    exec('sudo shutdown now');
    
  });
  
  socket.on('disconnect', function(){
    console.log('Disconnected id: %s', socket.id);
    log.info('Client disconnected ' + socket.id);
  }); 
  
    eventEmitter.on('CMDecho', function(data){
        socket.emit('CMD', data);

  }); 
 
    eventEmitter.on('serialData', function(data){
        socket.emit('serialData', data);

  }); 
 
});

io.on('disconnect', function () {
        //console.log('A socket with sessionID ' + hs.sessionID 
        //    + ' disconnected!');
	log.info('A socket with sessionID ' + hs.sessionID 
            + ' disconnected!');
    });

http.listen(serverPort, function(){
console.log('Server listening on ' + serverADDR + ':' + serverPort + ' video feed: ' + videoFeedPort);
log.info('Server listening on ' + serverADDR + ':' + serverPort + ' video feed: ' + videoFeedPort);

greetings();  
  
//Read input from Arduino and stores it into a dictionary
serialPort.on('data', function(data, socket) {	 	
/*
We store sensor data in arrays.
0/ send command via seiral to provide data
1/ check what are we receiving (first letter of the trnasmission)
2/ populate the correct variable

*/
	//"T" means we are receiving Telemetry data
        //console.log(data);
        //this emits raw data from Arduino for debug purposes
        eventEmitter.emit('serialData', data);
        
        if (data.indexOf('SCMD') !== -1)
	{
          eventEmitter.emit('CMDecho', data);  
        }
            
        if (data.indexOf('T') !== -1)
	{
	  var tokenData = data.split(SEPARATOR);
	  var j = 0;
	  
	  for (var i in Telemetry) {
	    Telemetry[i] = tokenData[j];
	    j++;
	    //console.log(i + ' ' + Telemetry[i]);
	  }
	  j = 0;
	  
	  //eventEmitter.emit('log', data);
	  
	  if (LogR == 1){
	    systemModules.addTelemetryRow(telemetryfilePath, TelemetryFN, TelemetryHeader, data, PIDHeader, PIDVal, SEPARATOR)
	  }
	}
	
	//"TH" means we are receiving Telemetry Headers
        if (data.indexOf('TH') !== -1)
	{
          TelemetryHeader = data.split(SEPARATOR);
	  var arrayLength = TelemetryHeader.length;
	  for (var i = 0; i < arrayLength; i++) {
	    Telemetry[TelemetryHeader[i]] = "N/A";
	    //console.log(TelemetryHeader[i]);
          }
        
          THReceived=1;
	  //eventEmitter.emit('log', data);
	}
	
	if (data.indexOf('SYSH') !== -1)
	{
	  ArduSysHeader = data.split(SEPARATOR);
	  var arrayLength = ArduSysHeader.length;
	  for (var i = 0; i < arrayLength; i++) {
	    ArduSys[ArduSysHeader[i]] = "N/A";
	    //console.log(TelemetryHeader[i]);
	}
            setTimeout(function () {
         	   serialPort.write('READ SYSParamTX\n\r');
        
            }, 100)
	 
        }
	
	if (data.indexOf('SYS') !== -1)
	{
	  var tokenData = data.split(SEPARATOR);
	  var j = 0;
	  
	  for (var i in Telemetry) {
	    ArduSys[i] = tokenData[j];
	    j++;
	    //console.log(i + ' ' + Telemetry[i]);
	  }
	  j = 0;
	  //eventEmitter.emit('log', data);
	}
	
        if (data.indexOf('PID') !== -1)
	{
	  var tokenData = data.split(SEPARATOR);
	  var j = 0;
          PIDVal = "";
          
	  for (var i in PID) {
	    PID[i] = tokenData[j];
            //PIDVal is used as a string to be concatenated in log file
	    PIDVal = PIDVal + SEPARATOR + PID[i];
	    j++;
	     }
	  j = 0;
	  //log.info('PID values changed ' + PIDHeader + '\n' + PIDVal);

	}
	
        if (data.indexOf('PIDH') !== -1)
	{
          PIDHeader = data.split(SEPARATOR);
          var arrayLength = PIDHeader.length;
	  for (var i = 0; i < arrayLength; i++) {
	    PID[PIDHeader[i]] = "N/A";
	    //console.log(PIDHeader[i]);// + ' ' + PID[PIDHeader[i]]);
	  }
	     setTimeout(function () {
                serialPort.write('READ PIDParamTX\n\r');
            }, 100);
        }
	
	//Change the first word to be 'ArduConfig'
	//If the first word is '***' prints in the server console. Used to debug the config from Arduino
	if (data.indexOf('***') !== -1)
	{
	  console.log(data);
	  log.info('Configuration received from Arduino: ' + data);

	}
	
	//Handle errors from Arduino
	if (data.indexOf('E') !== -1)
	{
          log.error('ERROR: ' + data);
        }
	  
	
	//IS THIS SILL RELEVANT?
	//Get the header for the object that stores telemetry data
	if (data.indexOf('HEADER') !== -1)
	{
	  TelemetryHeader = data.split(SEPARATOR);
	  var arrayLength = TelemetryHeader.length;
	  for (var i = 0; i < arrayLength; i++) {
	    Telemetry[TelemetryHeader[i]] = "N/A";
	    //console.log(TelemetryHeader[i]);
	  }
	}
	
	
});
 
});

module.exports.Telemetry = Telemetry;
//module.exports.temperature = temperature;
module.exports.nconf = nconf;
