guser.changeNick = function(newnick, silent) {
	irc.lastNick = guser.nick;
	guser.nick = newnick;
	$('#usernick').text(he(guser.nick));
	$(document).attr('title', he(guser.nick)+ ' @ PIRC.pl');
	if(!silent) {
		for (i in gateway.channels) {
			gateway.channels[i].appendMessage(messagePatterns.nickChangeOwn, [$$.niceTime(), he(guser.nick)]);
		}
	}
	return true;
}

guser.umodes = {};

guser.setUmode = function(modechar, plus){
	if(modechar){
		guser.umodes[modechar] = plus;
	}
	if(guser.umodes.r){
		$('#nickRegister').hide();
		$('.nickRegistered').show();
	} else {
		$('#nickRegister').show();
		$('.nickRegistered').hide();
	}
}

guser.clearUmodes = function(){
	guser.umodes = {};
}

var irc = {
	'lastNick': '',
	'messagedata': function() {
		this.text = '';
		this.args = [];
		this.tags = [];
		this.command = '';
		this.sender = {
			'nick': '',
			'ident': '',
			'host': '',
			'server': false,
			'user': false
		};
		this.time = new Date();
	},
	'oldData': '',
	'parseMessage': function(msg){
		var packets = [];
		var packetcnt = 0;
		packets[packetcnt++] = irc.parseLine(msg);
		return {'status': 2, 'packets': packets };
	},
	'parseTags': function(tagsLine){
		var tags = [];
		var tagState = tagStateKeyName;
		var keyValue;
		var keyName = '';
		for(var i = 0; i < tagsLine.length; i++){
			var cchar = tagsLine.charAt(i);
			switch(tagState){
				case tagStateKeyName:
					switch(cchar){
						case '=':
							tagState = tagStateKeyValue;
							keyValue = '';
							break;
						case ';':
							tags[keyName] = '';
							keyName = ''; // staying in tagStateKeyName
							break;
						default: keyName += cchar; break;
					}
					break;
				case tagStateKeyValue:
					switch(cchar){
						case '\\': tagState = tagStateKeyValueEscape; break;
						case ';':
							tags[keyName] = keyValue;
							keyName = '';
							tagState = tagStateKeyName;
							break;
						default: keyValue += cchar; break;
					}
					break;
				case tagStateKeyValueEscape:
					switch(cchar){
						case ':': keyValue += ';'; break;
						case 's': keyValue += ' '; break;
						case 'r': keyValue += '\r'; break;
						case 'n': keyValue += '\n'; break;
						default: keyValue += cchar; break;
					}
					tagState = tagStateKeyValue;
					break;
			}
		}
		if(keyName.length > 0) tags[keyName] = keyValue; // flush last tag
		return tags;
	},
	'parseLine': function(line){
		var ircmsg = new irc.messagedata();

		var line = line.trim();
		line.replace(/^\s+|\s+$/gm,'');
		
		if(line == ''){
			return;
		}
		
		var msglen = line.length;
	
		var pstate = stateStart;
		var currArg = '';
		var tags = '';
		var haveText = false;
		
		console.log(line);

		for(var i = 0; i < msglen; i++){
			var cchar = line.charAt(i);
			switch(pstate){
				case stateStart:
					switch(cchar){
						case '@': pstate = stateTags; break;
						case ':': pstate = stateSenderNick; break;
						default:
							pstate = stateCommand; 
							ircmsg.command += cchar;
							break;
					}
					break;
				case stateTags:
					switch(cchar){
						case ' ':
							pstate = stateStart;
							ircmsg.tags = irc.parseTags(tags);
							break;
						default: tags += cchar; break;
					}
					break;
				case stateSenderNick:
					switch(cchar){
						case '!': pstate = stateSenderUser; break;
						case '@': pstate = stateSenderHost; break;
						case ' ': pstate = stateCommand; break;
						default: ircmsg.sender.nick += cchar; break;
					}
					break;
				case stateSenderUser:
					switch(cchar){
						case '@': pstate = stateSenderHost; break;
						case ' ': pstate = stateCommand; break;
						default: ircmsg.sender.ident += cchar; break;
					}
					break;
				case stateSenderHost:
					switch(cchar){
						case ' ': pstate = stateCommand; break;
						default: ircmsg.sender.host += cchar; break;
					}
					break;
				case stateCommand:
					switch(cchar){
						case ' ': pstate = stateArgs; break;
						default: ircmsg.command += cchar; break;
					}
					break;
				case stateArgs:
					switch(cchar){
						case ' ':
							if(currArg != ''){
								ircmsg.args.push(currArg);
							}
							currArg = '';
							break;
						case ':':
							if(prevChar == ' '){
								pstate = stateMessage;
								haveText = true;
							} else {
								currArg += cchar;
							}
							break;
						default: currArg += cchar; break;
					}
					break;
				case stateMessage:
					ircmsg.text += cchar;
					break;
			}
			var prevChar = cchar;
		}
		if(pstate == stateArgs){
			ircmsg.args.push(currArg);
		}
	
		if(ircmsg.sender.ident == '' && ircmsg.sender.host == '' && ircmsg.sender.nick.indexOf('.')!=-1){
			ircmsg.sender.server = true;
		} else {
			ircmsg.sender.user = true;
		}

		if(!haveText){
			ircmsg.text = ircmsg.args[ircmsg.args.length-1]; // handling last argument as text if : is missing
		} else {
			ircmsg.args.push(ircmsg.text); // handling text as a last argument as required by the protocol
		}

// add u@h
		if(ircmsg.sender.user){
			if(ircmsg.sender.ident) users.getUser(ircmsg.sender.nick).setIdent(ircmsg.sender.ident);
			if(ircmsg.sender.host) users.getUser(ircmsg.sender.nick).setHost(ircmsg.sender.host);
		}

// process known tags
		if('time' in ircmsg.tags){
			ircmsg.time = parseISOString(ircmsg.tags['time']);
		}

		if('account' in ircmsg.tags){
			users.getUser(ircmsg.sender.nick).setAccount(ircmsg.tags['account']);
		}

		console.log(ircmsg);

		return ircmsg;
	}
};

var gateway = {
	'websock': 0,
	'whois': '',
	'connectStatus': statusDisconnected,
	'joined': 0,
	'setConnectedWhenIdentified': 0,
	'connectTimeoutID': 0,
	'pingIntervalID': false,
	'whoChannelsIntervalID': false,
	'disconnectMessageShown': 0,
	'displayOwnWhois': false,
	'firstConnect': 1, //jeśli dostanę ERROR gdy to jest nadal 1 = błąd z poprzedniej sesji, od razu łączę ponownie
	'allowNewSend' : true,
	'statusWindow': new Status(),
	'userQuit': false,
	'sasl': false,
	'commandProcessing': false,
	'whowasExpect312': false,
	'lastKeypressWindow': false,
	'keypressSuppress': false,
	'retrySasl': false,
	'chanPassword': function(chan) {
		if($('#chpass').val() == ''){
			$$.alert('Nie podałeś hasła!');
			return false;
		}
		ircCommand.channelJoin(chan, $('#chpass').val());
		$(".errorwindow").fadeOut(250);
		return true;
	},
	'reconnect': function() { //wywoływana po kliknięciu 'połącz ponownie'
		gateway.websock.onerror = undefined;
		gateway.websock.onclose = undefined;
		gateway.websock.close();
		gateway.websock = false;
		setTimeout(function(){
			gateway.connectStatus = statusDisconnected;
			$$.closeDialog('connect', 'reconnect');
			$$.displayDialog('connect', '1', 'Łączenie', 'Ponowne łączenie, czekaj...');
			gateway.connect(true);
		}, 500);
	},
	'iKnowIAmConnected': function() { //użytkownik może już pisać na kanale
		if(!gateway.pingIntervalID){
			gateway.pingIntervalID = setInterval(function(){
				gateway.ping();
			}, 20000);
		}
		gateway.setConnectedWhenIdentified = 1;
		$$.closeDialog('connect', '1');
		$$.closeDialog('connect', 'reconnect');
		clearTimeout(gateway.connectTimeoutID); //już ok więc nie czekam na nieudane połączenie
		connectTimeoutID = false;
		gateway.firstConnect = 0;
		if (gateway.getActive() && gateway.findChannel(gateway.active)) {
			$('#'+gateway.findChannel(gateway.active).id+'-nicklist').show(); //gwarantuje pokazanie listy nicków na bieżącym kanale po ponownym połączeniu
		}
	},
	'pingcnt': 0,
	'disconnected': function(text) { //informacja w okienkach i ich blokowanie przy rozłączeniu
		clearTimeout(gateway.connectTimeoutID);
		gateway.websock.onerror = undefined;
		gateway.websock.onclose = undefined;
		gateway.connectTimeoutID = false;
		clearInterval(gateway.pingIntervalID);
		users.clear();
		gateway.pingIntervalID = false;
		if(guser.nickservnick != ''){
			irc.lastNick = guser.nick;
			guser.nick = guser.nickservnick;
		}
		if(gateway.disconnectMessageShown) {
			return;
		}
		gateway.disconnectMessageShown = 1;
		for(c in gateway.channels) {
			gateway.channels[c].part();
			gateway.channels[c].appendMessage(messagePatterns.error, [$$.niceTime(), text]);
		}
		gateway.statusWindow.appendMessage(messagePatterns.error, [$$.niceTime(), text]);
	},
	'ping': function() { //pytanie IRCD o ping i błąd kiedy brak odpowiedzi
		if(gateway.connectStatus != statusConnected) {
			gateway.pingcnt = 0;
			return;
		}
		gateway.forceSend('PING :JavaScript');
	//	gateway.forceSend('MODE '+guser.nick); //jest aktualna informacja o umodach, a przy okazji załatwiony ping
		if(gateway.pingcnt > 3) {
			gateway.connectStatus = statusError;
			if($('#autoReconnect').is(':checked')){
				gateway.reconnect();
			} else {
				$$.displayReconnect();
			}
			gateway.disconnected('Przekroczony czas odpowiedzi serwera');
			gateway.pingcnt = 0;
		} else {
			gateway.pingcnt++;
		}
	},
	'configureConnection': function(){
		gateway.websock.onmessage = gateway.onRecv;
		gateway.websock.onerror = gateway.sockError;
		gateway.websock.onclose = gateway.sockError;
		if(gateway.delayedSendTimer){
			clearInterval(gateway.delayedSendTimer);
			gateway.delayedSendTimer = false;
		}
		gateway.delayedSendTimer = setInterval(function(){
			if(gateway.toSend.length > 0){
				gateway.forceSend(gateway.toSend.shift());
			} else {
				if(gateway.sendDelayCnt > 0){
					gateway.sendDelayCnt--;	
				}
			}
		}, 1000);
	},
	'connect': function(force) {
		gateway.userQuit = false;
		gateway.connectTimeoutID = setTimeout(gateway.connectTimeout, 20000);
		gateway.websock = new WebSocket(server);
		gateway.websock.onopen = function(e){
			gateway.configureConnection();
			var username = 'Użytkownik bramki PIRC.pl';
			try {
				var ckNick = localStorage.getItem('origNick');
			 	if(ckNick){
					username += ' "'+ckNick+'"';
				}
			} catch(e) {}
			if(token != ''){
				gateway.send(Base64.decode(token));
			}
			ircCommand.performQuick('CAP', ['LS']);
			ircCommand.performQuick('USER', ['pirc', '*', '*'], username);
			ircCommand.changeNick(guser.nick);
			gateway.sasl = false;
			gateway.connectTime = (+new Date)/1000;
		}

	},
	'processData': function(data) {
	//	while(gateway.commandProcessing); // potrzebne czy nie?
		gateway.commandProcessing = true;
		for (i in data.packets) { //wywoływanie funkcji 'handlerów' od poleceń
			try {
				var msg = data.packets[i];
				var command = msg.command
				if(command in cmdBinds) {
					if(cmdBinds[command].length == 0){ // implementation empty
						cmdNotImplemented(msg);
					} else {
						for(func in cmdBinds[command]) {
							cmdBinds[command][func](msg);
						}
					}
				} else { // not implemented
					cmdNotImplemented(msg);
				}
			} catch(error) {
				console.log('Błąd przetwarzania komunikatu!');
				console.log(msg);
				console.log(error);
			}
		}
		gateway.commandProcessing = false;
	},
	'sockError': function(e) {
		console.log('WebSocket error!');
		setTimeout(function(){
			if(gateway.connectStatus != statusDisconnected && gateway.connectStatus != statusError && gateway.connectStatus != statusBanned){
				gateway.connectStatus = statusError;
				gateway.disconnected('Utracono połączenie z serwerem');
				if($('#autoReconnect').is(':checked')){
					gateway.reconnect();
				} else {
					$$.displayReconnect();
				}
			}
		}, 1000);
	},
	'onRecv': function(sdata) {
		//data = irc.parseMessage(Base64.decode(sdata.data));
		var reader = new FileReader();
		reader.addEventListener("loadend", function() {
		   // reader.result contains the contents of blob as a typed array
			data = irc.parseMessage(reader.result);
			gateway.processData(data);
			gateway.processStatus();
		});
		reader.readAsText(sdata.data);

//		data = irc.parseMessage(sdata.data);
//		gateway.processData(data);
//		gateway.processStatus();
	},
	'ctcp': function(dest, text) {
		ircCommand.sendCtcpRequest(dest, text);
		console.log('użyto gateway.ctcp, powinno być ircCommand.sendCtcpRequest');
	},
	'processStatus': function() {
		if(guser.nickservpass != '' && guser.nickservnick != ''){
			if(gateway.connectStatus == status001) {
				if(guser.nick != guser.nickservnick) { //auto-ghost
					gateway.connectStatus = statusGhostSent;
					ircCommand.NickServ('RECOVER', [guser.nickservnick, guser.nickservpass]);
					gatewayStatus = statusGhostSent;
				} else gateway.connectStatus = statusIdentified;
			}
			if(gateway.connectStatus == statusReIdentify){
				if(guser.nick != guser.nickservnick){
					gateway.connectStatus = statusGhostSent;
					ircCommand.NickServ('RECOVER', [guser.nickservnick, guser.nickservpass]);
				} else {
					gateway.connectStatus = statusIdentified;
					if(!gateway.sasl){
						ircCommand.NickServ('IDENTIFY', guser.nickservpass);
					} else {
						gateway.retrySasl = true;
						ircCommand.performQuick('AUTHENTICATE', ['PLAIN']);
						var date = new Date();
						gateway.statusWindow.appendMessage(messagePatterns.SaslAuthenticate, [$$.niceTime(date), 'Próba logowania za pomocą SASL...']);
					}					
				}
			}
			if(gateway.connectStatus == statusGhostAndNickSent && guser.nick == guser.nickservnick){ //ghost się udał
				if(gateway.nickWasInUse){
					var html = '<p>I już nie jest: usunąłem go używając Twojego hasła :)</p>';
					$$.displayDialog('warning', 'warning', 'Ostrzeżenie', html);
					gateway.nickWasInUse = false;
				}
				gateway.connectStatus = statusIdentified;
			}
		} else {
			if(gateway.connectStatus == status001) { //nie ma hasła więc od razu uznajemy że ok
				gateway.connectStatus = statusIdentified;
			}
		}
		if(gateway.connectStatus == statusIdentified && gateway.setConnectedWhenIdentified == 1){ //podłączony, a szare tło schowane już wcześniej
			gateway.connectStatus = statusConnected;
		}
		if(gateway.connectStatus == statusConnected){
			gateway.setConnectedWhenIdentified = 0;
			if(!gateway.joined) {
				$('#input').focus();
			//	gateway.joinChannels();
				gateway.joined = 1;
				gateway.disconnectMessageShown = 0; //tutaj resetuję
				// ustawianie usermode wg konfiguracji dopiero teraz
				if(guser.umodes.R && !$('#setUmodeR').is(':checked')){
					ircCommand.umode('-R');
				} else if(!guser.umodes.R && $('#setUmodeR').is(':checked')){
					ircCommand.umode('+R');
				}
				if(guser.umodes.D && !$('#setUmodeD').is(':checked')){
					ircCommand.umode('-D');
				} else if(!guser.umodes.D && $('#setUmodeD').is(':checked')){
					ircCommand.umode('+D');
				}
			}
		} else {
			gateway.joined = 0;
		}
	},
	'joinChannels': function() {
		ircCommand.channelJoin(guser.channels);
		ircCommand.channelJoin(gateway.channels);
	},
	'connectTimeout': function() {
		gateway.connectTimeoutID = false;
		if(gateway.userQuit){
			return;
		}
		if(gateway.connectStatus != statusConnected){
			var button = [ {
				text: 'Połącz ponownie',
				click: function(){
					gateway.stopAndReconnect();
				}
			} ];
			$$.closeDialog('connect', '1');
			$$.displayDialog('connect', 'reconnect', 'Łączenie', '<p>Łączenie trwa zbyt długo. Możesz poczekać lub spróbować jeszcze raz.</p>', button);
		}
	},
	'stopAndReconnect': function () {
		gateway.disconnected('Zbyt długi czas łączenia');
		if(gateway.websock.readyState === WebSocket.OPEN) ircCommand.quit('Błąd bramki >> łączenie trwało zbyt długo');
		setTimeout('gateway.reconnect()', 500);
	},
	'initSys': function() {
		var html = 'Poczekaj, trwa łączenie...<br />Nie używaj teraz przycisku "Wstecz" ani "Odśwież".';
		$$.displayDialog('connect', '1', 'Łączenie', html);
	},
	'initialize': function() {
		if($('#automLogIn').is(':checked')){
			if(conn.my_nick == '' || conn.my_reqChannel == ''){
				$$.alert('Błąd wczytywania danych z ciasteczek. Wpisz dane.');
				return false;
			}
			var nickInput = conn.my_nick;
			var chanInput = conn.my_reqChannel;
			var passInput = conn.my_pass;
		} else {
			var nickInput = $('#nsnick').val();
			var chanInput = $('#nschan').val();
			var passInput = $('#nspass').val();
			if(nickInput == ''){
				$$.alert('Musisz podać nicka!');
				return false;
			}
			if(chanInput == ''){
				$$.alert('Musisz podać kanał!');
				return false;
			}
			if(!nickInput.match(/^[\^\|0-9a-z_`\{\}\[\]\-]+$/i)) {
				$$.alert('Nick zawiera niedozwolone znaki!');
				return false;
			}
			if(nickInput.match(/^[0-9-]/)){
				$$.alert('Nick nie może zaczynać się od cyfry ani minusa!');
				return false;
			}
			if(!chanInput.match(/^[#,a-z0-9_\.\-\\]+$/i)) {
				$$.alert('Kanał zawiera niedozwolone znaki!');
				return false;
			}
			if(passInput.match(/[ ]+/i)) {
				$$.alert('Hasło nie powinno zawierać spacji!');
				return false;
			}
		}
		if($('#enableautomLogIn').is(':checked')){
			$('#automLogIn').prop('checked', true);
			disp.changeSettings();
			var button = [ {
				text: 'OK',
				click: function(){
					$(this).dialog('close');
				}
			} ];
			$$.displayDialog('connect', '2', 'Informacja', 'Możesz wyłączyć automatyczne łączenie, na przykład w celu zmiany danych, klikając na ikonę ustawień w prawym górnym rogu, i odznaczając pole "Automatyczne łączenie".', button);
		}
		if(nickInput != guser.nick) {
			guser.changeNick(nickInput);
		}
		guser.channels = [ chanInput ];
		if(passInput != '') {
			guser.nickservnick = nickInput;
			guser.nickservpass = passInput;
		}
		try {
			if(chanInput){
				localStorage.setItem('channel', chanInput);
			}
			if(nickInput){
				localStorage.setItem('nick', nickInput);
			}
			if($('#save_password').is(":checked")){
				if(guser.nickservnick && guser.nickservpass){
					localStorage.setItem('password', btoa(guser.nickservpass));
				}
			}
		} catch(e) {}
		guser.account = guser.nick;
		gateway.initSys();
		gateway.connect(false);

		return true;
	},
	'delayedSendTimer': false,
	'toSend': [],
	'sendDelayCnt': 0,
	'sendDelayed': function(data){
		gateway.toSend.push(data);
	},
	'send': function(data) {
		if(gateway.websock.readyState === gateway.websock.OPEN && (gateway.sendDelayCnt < 3 || gateway.connectStatus != statusConnected)){
			gateway.forceSend(data);
			gateway.sendDelayCnt++;
		} else {
			gateway.toSend.push(data);
		}
	},
	'forceSend': function(data){
		if(gateway.websock.readyState === gateway.websock.OPEN){
			console.log('← '+data);
			//sdata = Base64.encode(data+'\r\n');
			sdata = data + '\r\n';
			gateway.websock.send(sdata);
		} else {
			console.log('Outmsg delayed: '+data);
			gateway.toSend.push(data);
		}
	},
	'channels': [],
	'findChannel': function(name) {
		if(typeof(name) != 'string') return false;
		for (i in gateway.channels) {
			if(gateway.channels[i] && gateway.channels[i].name.toLowerCase() == name.toLowerCase()) {
				return gateway.channels[i];
			}
		}
		return false;
	},
	'removeChannel': function(name) {
		if(typeof(name) != 'string') return false;
		var channels2 = [];
		for (i in gateway.channels) {
			if(gateway.channels[i] && gateway.channels[i].name.toLowerCase() == name.toLowerCase()) {
				gateway.findChannel(name).markRead();
				gateway.channels[i].close();
			} else if(gateway.channels[i]) {
				channels2.push(gateway.channels[i]);
			}
		}
		gateway.channels = channels2;
		$('#input').focus();
		return false;
	},
	'queries': [],
	'findQuery': function(name) {
		if(typeof(name) != 'string') return false;
		for (i in gateway.queries) {
			if(gateway.queries[i] && gateway.queries[i].name.toLowerCase() == name.toLowerCase()) {
				return gateway.queries[i];
			}
		}
		return false;
	},
	'removeQuery': function(name) {
		if(typeof(name) != 'string') return false;
		var queries2 = [];
		for (i in gateway.queries) {
			if(gateway.queries[i] && gateway.queries[i].name.toLowerCase() == name.toLowerCase()) {
				gateway.findQuery(name).markRead();
				gateway.queries[i].close();
			} else if(gateway.queries[i]) {
				queries2.push(gateway.queries[i]);
			}
		}
		gateway.queries = queries2;
		$('#input').focus();
		return false;
	},
	'changeTopic': function(channel) {
		if(!confirm('Czy zmienić temat dla '+channel+'? Nie można tego cofnąć.')){
			return false;
		}
		var newTopic = $('#topicEdit').val().replace(/\n/g, ' ');
		ircCommand.channelTopic(channel, newTopic);
		$$.closeDialog('confirm', 'topic');
		return true;
	},
	'tabHistory': ['--status'],
	'lasterror': '',
	'nickListVisibility': true,
	'nickListToggle': function() {
		var active = gateway.getActive();
		if(!active){
			active = gateway.statusWindow;
		}
		active.saveScroll();
		if($("#nicklist").width() > 40) {
			$("#nicklist").animate({
				"opacity": "toggle",
				"width":	"40px"
			}, 400);
			$("#chstats").animate({
				"opacity": "toggle",
				"width":	"40px"
			}, 400);
			$("#chatbox").animate({
				"width":	"97%"
			}, 401, function () {
				$("#nicklist-closed").fadeIn(200);
				setTimeout(function(){
					gateway.getActive().restoreScroll();
				}, 250);
			});
			$('#nickopts').css('display', 'none');
			$('#chlist').css('display', 'none');
			gateway.nickListVisibility = false;
		} else {
			gateway.showNickList();
			gateway.nickListVisibility = true;
		}
		gateway.checkNickListVisibility();
		$('#input').focus();
	},
	'checkNickListVisibility': function() {
		setTimeout(function(){
			if(!$('#nicklist-closed').is(':visible') && !$('#nicklist').is(':visible')){
				gateway.showNickList();
			}
		}, 1500);
	},
	'showNickList': function() {
		$("#nicklist-closed").fadeOut(200, function () {
			$("#nicklist").animate({
				"opacity": "show",
				"width":	"23%"
			}, 400);
			$("#chstats").animate({
				"opacity": "show",
				"width":	"23%"
			}, 400);
			$("#chatbox").animate({
				"width":	"77%"
			}, 401);
			setTimeout(function(){
				var tab = gateway.getActive();
				if(!tab){
					tab = gateway.statusWindow;
				}
				tab.restoreScroll();
				$('#nickopts').css('display', '');
				$('#chlist').css('display', '');
			}, 450);
		});
	},
	'insert': function(text) {
		var input = $('#input');
		var oldText = input.val();
		input.focus();
		input.val(oldText + text);
	}, 
	'insertColor': function(color) {
		gateway.insert(String.fromCharCode(3) + (color<10?'0':'') + color.toString());
	},
	'insertCode': function(code) {
		var text = false;
		switch(code){
			case 2: text = String.fromCharCode(2); break;
			case 3: text = String.fromCharCode(3); break;
			case 15: text = String.fromCharCode(15); break;
			case 22: text = String.fromCharCode(22); break;
			case 29: text = String.fromCharCode(29); break;
			case 31: text = String.fromCharCode(31); break;
		}
		if(text) gateway.insert(text);
	},
	'nextTab': function() {
		var swtab = $('li.activeWindow').next().find('a.switchTab');
		if(swtab){
			swtab.trigger('click');
		}
	},
	'prevTab': function() {
		var swtab = $('li.activeWindow').prev().find('a.switchTab');
		if(swtab){
			swtab.trigger('click');
		}
	},
	'switchTab': function(chan) {
		var act = gateway.getActive();
		if(act){
			act.saveScroll();
			act.setMark();
		} else {
			gateway.statusWindow.saveScroll();
			gateway.statusWindow.setMark();
		}
		chan = chan.toLowerCase();
		if(chan != "--status" && gateway.findChannel(chan)) {
			$('#main-window > span').hide();
			$('#nicklist-main > span').hide();
			$('#chstats > div').hide();
			$('#info > span').hide();
			$('#'+gateway.findChannel(chan).id+'-nicklist').show();
			$('#tabs > li').removeClass("activeWindow");
			$('#'+gateway.findChannel(chan).id+'-tab').addClass("activeWindow");
			$('#'+gateway.findChannel(chan).id+'-window').show();
			$('#'+gateway.findChannel(chan).id+'-chstats').show();
			$('#'+gateway.findChannel(chan).id+'-topic').show();
			$('#'+gateway.findChannel(chan).id+'-topic').prop('title', 'Kliknij aby zobaczyć cały temat');
			gateway.findChannel(chan).markRead();
			gateway.active = chan;
			gateway.tabHistory.push(chan);
			$('#input').focus();
			if($("#nicklist").width() < 41 && gateway.nickListVisibility) {
				$("#nicklist-closed").fadeOut(1, function () {
					$("#nicklist").animate({
						"opacity": "toggle",
						"width":	"23%"
					}, 1);
					$("#chstats").animate({
						"opacity": "toggle",
						"width":	"23%"
					}, 1);
					$("#chatbox").animate({
						"width":	"77%"
					}, 1, function() {
						gateway.findChannel(chan).restoreScroll();
						setTimeout(function(){
							gateway.findChannel(chan).restoreScroll();
						}, 200);
						$('#nickopts').css('display', '');
						$('#chlist').css('display', '');
					});
				});
			} else {
				gateway.findChannel(chan).restoreScroll();
				setTimeout(function(){
					gateway.findChannel(chan).restoreScroll();
				}, 200);
			}
			
		} else if(chan != "--status" && gateway.findQuery(chan)) {
			$('#main-window > span').hide();
			$('#nicklist-main > span').hide();
			$('#info > span').hide();
			$('#chstats > div').hide();
			$('#--status-nicklist').show();
			$('#tabs > li').removeClass("activeWindow");
			$('#'+gateway.findQuery(chan).id+'-tab').addClass("activeWindow");
			$('#'+gateway.findQuery(chan).id+'-window').show();
			$('#'+gateway.findQuery(chan).id+'-topic').show();
			$('#'+gateway.findQuery(chan).id+'-chstats').show();
			$('#'+gateway.findChannel(chan).id+'-topic').prop('title', '');
			gateway.active = chan;
			gateway.tabHistory.push(chan);
			$('#input').focus();
			if($("#nicklist").width() > 40) {
				$("#nicklist").animate({
					"opacity": "toggle",
					"width":	"40px"
				}, 1);
				$("#chstats").animate({
					"opacity": "toggle",
					"width":	"40px"
				}, 1);
				$("#chatbox").animate({
					"width":	"97%"
				}, 1, function () {
					$("#nicklist-closed").fadeIn(1);
					gateway.findQuery(chan).restoreScroll();
					setTimeout(function(){
						gateway.findQuery(chan).restoreScroll();
					}, 200);
					$('#nickopts').css('display', 'none');
					$('#chlist').css('display', 'none');
				});
			} else {
				gateway.findQuery(chan).restoreScroll();
				setTimeout(function(){
					gateway.findQuery(chan).restoreScroll();
				}, 200);
			}
			gateway.findQuery(chan).markRead();
		} else if(chan == "--status") {
			$('#main-window > span').hide();
			$('#nicklist-main > span').hide();
			$('#info > span').hide();
			$('#chstats > div').hide();
			$('#--status-nicklist').show();
			$('#tabs > li').removeClass("activeWindow");
			$('#--status-tab').addClass("activeWindow");
			$('#--status-window').show();
			$('#--status-topic').show();
			$('#--status-chstats').show();
			$('#'+gateway.findChannel(chan).id+'-topic').prop('title', '');
			gateway.statusWindow.markRead();
			gateway.active = chan;
			gateway.tabHistory.push(chan);
			$('#input').focus();
			if($("#nicklist").width() > 40) {
				$("#nicklist").animate({
					"opacity": "toggle",
					"width":	"40px"
				}, 1);
				$("#chstats").animate({
					"opacity": "toggle",
					"width":	"40px"
				}, 1);
				$("#chatbox").animate({
					"width":	"97%"
				}, 1, function () {
					$("#nicklist-closed").fadeIn(1);
					gateway.statusWindow.restoreScroll();
					setTimeout(function(){
						gateway.statusWindow.restoreScroll();
					}, 200);
					$('#nickopts').css('display', 'none');
					$('#chlist').css('display', 'none');
				});
			} else {
				gateway.statusWindow.restoreScroll();
				setTimeout(function(){
					gateway.statusWindow.restoreScroll();
				}, 200);
			}
		}
		gateway.checkNickListVisibility();
	},
	'tabHistoryLast': function(ignore) {
		var ignorec = ignore.toLowerCase();
		for(var i=gateway.tabHistory.length; i > 0; i--) {
			if(gateway.tabHistory[i] && ((gateway.findChannel(gateway.tabHistory[i]) || gateway.findChannel(gateway.tabHistory[i])) && (!ignorec || ignorec != gateway.tabHistory[i]))) {
				return gateway.tabHistory[i];
			}
		}
		return '--status';
	},
	'notEnoughParams': function(command, reason) {
		if(gateway.getActive()) {
			gateway.getActive().appendMessage(messagePatterns.notEnoughParams, [$$.niceTime(), command, reason]);
		} else {
			gateway.statusWindow.appendMessage(messagePatterns.notEnoughParams, [$$.niceTime(), command, reason]);
		}
	},
	'callCommand': function(command, input, alias) {
		if(alias && alias in commands) {
			if(typeof(commands[alias].callback) == 'string') {
				return gateway.callCommand(command, input, commands[alias].callback);
			} else if(typeof(commands[alias].callback) == 'function') {
				commands[alias].callback(command, input);
				return true;
			} else {
				return false;
			}
		} else if(command[0].toLowerCase() in commands) {
			if(typeof(commands[command[0].toLowerCase()].callback) == 'string') {
				return gateway.callCommand(command, input, commands[command[0].toLowerCase()].callback);
			} else if(typeof(commands[command[0].toLowerCase()].callback) == 'function') {
				commands[command[0].toLowerCase()].callback(command, input);
				return true;
			} else {
				return false;
			}
		} else {
			return false;
		}
	},
	'parseUserCommand': function(input) {
		command = input.slice(1).split(" ");
		if(!gateway.callCommand(command, input)) {
			if (gateway.getActive()) {
				gateway.getActive().appendMessage(messagePatterns.noSuchCommand, [$$.niceTime(), he(command[0])]);
			} else {
				gateway.statusWindow.appendMessage(messagePatterns.noSuchCommand, [$$.niceTime(), he(command[0])]);
			}
		}
	},
	'sendSingleMessage': function(text, active){
		ircCommand.sendMessage(gateway.getActive().name, text);
		var message = $$.colorize(text);
		for(f in messageProcessors){
			message = messageProcessors[f](guser.nick, active.name, message);
		}
		if(activeCaps.indexOf('echo-message') <= 0) active.appendMessage(messagePatterns.yourMsg, [gateway.getMeta(guser.nick), $$.niceTime(), $$.nickColor(guser.nick), guser.nick, message]);
	},
	'parseUserMessage': function(input){
		var active = gateway.getActive();
		if(active) {
			var textToSend = input;
			if(lengthInUtf8Bytes(textToSend) >= 420){
				var button = [ {
					text: 'Tak',
					click: function(){
						do {
							var sendNow = '';
							while(lengthInUtf8Bytes(sendNow)<420 && textToSend.length > 0){
								sendNow += textToSend.charAt(0);
								textToSend = textToSend.substring(1);
							}
							/*var sendNow = textToSend.substring(0, 420);
							textToSend = textToSend.substring(420);*/
							gateway.sendSingleMessage(sendNow, active);
						} while (textToSend != "");
						if(activeCaps.indexOf('echo-message') <= 0) active.appendMessage('%s', [$$.parseImages(input)]);
						$(this).dialog('close');
					}
				}, {
					text: 'Nie',
					click: function(){
						$(this).dialog('close');
					}
				} ];
				var html = 'Wpisany tekst nie zmieści się w jednej linijce. Czy na pewno chcesz go wysłać?<br><br><strong>'+$$.sescape(input)+'</strong>';
				$$.displayDialog('confirm', 'command', 'Potwierdź', html, button);
			} else {
				gateway.sendSingleMessage(input, active);
				if(activeCaps.indexOf('echo-message') <= 0) active.appendMessage('%s', [$$.parseImages(input)]);
			}
		}
	},
	'parseUserInput': function(input) {
		if(!input){
			input = '';
		}
		if($('#sendEmoji').is(':checked')){
			input = $$.textToEmoji(input);
		}
		if (!input) {
			return;
		}
		if(gateway.connectStatus > 0) {
			var regexp = /^\s+(\/.*)$/;
			var match = regexp.exec(input);
			if(match){
				var button = [ {
					text: 'Wyślij wiadomość',
					click: function(){
						gateway.parseUserMessage(input);
						$(this).dialog('close');
					}
				}, {
					text: 'Wykonaj polecenie',
					click: function(){
						gateway.parseUserCommand(match[1]);
						$(this).dialog('close');
					}
				}, {
					text: 'Anuluj',
					click: function(){
						$(this).dialog('close');
					}
				} ];
				var html = 'Wpisany tekst zaczyna się od znaku "/", ale poprzedzonego spacją. Aby uniknąć pomyłki, wybierz, co chcesz zrobić.<br><br><strong>'+$$.sescape(input)+'</strong>';
				$$.displayDialog('confirm', 'command', 'Potwierdź', html, button);
			} else {
				regexp = /^(#[^ ,]{1,25})$/;
				match = regexp.exec(input);
				if(match){
					var button = [ {
						text: 'Wyślij wiadomość',
						click: function(){
							gateway.parseUserMessage(input);
							$(this).dialog('close');
						}
					}, {
						text: 'Dołącz do '+input,
						click: function(){
							ircCommand.channelJoin(input);
							$(this).dialog('close');
						}
					}, {
						text: 'Anuluj',
						click: function(){
							$(this).dialog('close');
						}
					} ];
					var html = 'Wpisana wiadomość wygląda jak nazwa kanału IRC. Podawanie nazw kanałów na innych kanałach jest często uznawane jako spam. Aby uniknąć pomyłki, wybierz, co chcesz zrobić.<br><br><strong>'+$$.sescape(input)+'</string>';
					$$.displayDialog('confirm', 'command', 'Potwierdź', html, button);
				} else if(input.charAt(0) == "/") {
					gateway.parseUserCommand(input);
				} else {
					gateway.parseUserMessage(input);
				}
			}
		} else {
			if (gateway.getActive()) {
				gateway.getActive().appendMessage(messagePatterns.notConnected, [$$.niceTime()]);
			} else {
				gateway.statusWindow.appendMessage(messagePatterns.notConnected, [$$.niceTime()]);
			}
		}
		$("#input").val("");
	},
	'performCommand': function(input){
		input = '/' + input;
		var command = input.slice(1).split(" ");
		if(!gateway.callCommand(command, input)) {
			console.log('Invalid performCommand: '+command[0]);
		}
	},
	'commandHistory': [],
	'commandHistoryPos': -1,
	'inputFocus': function() {
		if(window.getSelection().toString() == ''){
			$("#input").focus();
		}
	},
	'openQuery': function(nick, id) {
		if(ignore.ignoring(nick, 'query')){
			var button = [
				{
					text: 'Zmień ustawienia',
					click: function(){
						ignore.askIgnore(nick);
						$(this).dialog('close');
					}
				},
				{
					text: 'OK',
					click: function(){
						$(this).dialog('close');
					}
				}
			];
			var html = '<p>Nie możesz rozmawiać prywatnie z tym użytkownikiem, ponieważ jest na Twojej liście ignorowanych.</p>';
			$$.displayDialog('error', 'ignore', 'Błąd', html, button);
			return;
		}
		gateway.findOrCreate(nick, true);
		if(id){
			gateway.toggleNickOpt(id);
		}
	},
	'showStatus': function(channel, nick) {
		var html = '<p>Daj użytkownikowi <strong>'+he(nick)+'</strong> bieżące uprawnienia na kanale <strong>'+he(channel)+'</strong>:</p>' +
			'<select id="admopts-add-'+md5(channel)+'">' +
				'<option value="-">Wybierz opcję</option>'+
				'<option value="+v">VOICE (Uprawnienie do głosu)</option>'+
				'<option value="+h">HALFOP (Pół-operator kanału)</option>'+
				'<option value="+o">OP (Operator kanału)</option>'+
				'<option value="+a">PROTECT/SOP (Administrator, ochrona przed kopnięciem)</option>'+
				'<option value="+q">FOUNDER (Właściciel kanału)</option>'+
			'</select>' +
			'<p>Daj użytkownikowi <strong>'+he(nick)+'</strong> uprawnienia w ChanServ (na stałe) na kanale <strong>'+he(channel)+'</strong><br>(musisz posiadać odpowiedni dostęp do serwisów):</p>' +
			'<select id="admopts-addsvs-'+md5(channel)+'">' +
				'<option value="-">Wybierz opcję</option>'+
				'<option value="VOP">VOP: VOICE (Uprawnienie do głosu)</option>'+
				'<option value="HOP">HOP: HALFOP (Pół-operator kanału)</option>'+
				'<option value="AOP">AOP: OP (Operator kanału)</option>'+
				'<option value="SOP">SOP: PROTECT/SOP (Administrator, ochrona przed kopnięciem)</option>'+
				'<option value="QOP">QOP: FOUNDER (Właściciel kanału)</option>'+
			'</select>';
		var button = [
			{
				text: 'Anuluj',
				click: function(){
					$(this).dialog('close');
				}
			},
			{
				text: 'OK',
				click: function(){
					var mode = $('#admopts-add-'+md5(channel)).val();
					var svsmode = $('#admopts-addsvs-'+md5(channel)).val();
					if(mode == '-' && svsmode == '-'){
						$$.alert('Wybierz jedną z opcji!');
						return;
					}
					if(mode != '-') ircCommand.mode(channel, mode+' '+nick);
					if(svsmode != '-') ircCommand.ChanServ(svsmode, [channel, 'ADD', nick]);
					$(this).dialog('close');
				}
			}
		];
		$$.displayDialog('admin', channel, 'Zarządzanie '+he(channel), html, button);
	},
	'showStatusAnti': function(channel, nick) {
		var html = '<p>Odbierz użytkownikowi <strong>'+he(nick)+'</strong> bieżące uprawnienia na kanale <strong>'+he(channel)+'</strong>:</p>' +
			'<select id="admopts-del-'+md5(channel)+'">' +
				'<option value="-">Wybierz opcję</option>'+
				'<option value="-v">VOICE (Uprawnienie do głosu)</option>'+
				'<option value="-h">HALFOP (Pół-operator kanału)</option>'+
				'<option value="-o">OP (Operator kanału)</option>'+
				'<option value="-a">PROTECT (Ochrona przed kopnięciem)</option>'+
				'<option value="-q">FOUNDER (Właściciel kanału)</option>'+
			'</select>' +
			'<p>Usuń całkowicie użytkownika <strong>'+he(nick)+'</strong> z listy uprawnień w ChanServ (na stałe) na kanale <strong>'+he(channel)+'</strong><br>(musisz posiadać odpowiedni dostęp do serwisów):</p>' +
			'<select id="admopts-delsvs-'+md5(channel)+'">' +
				'<option value="-">Nie, nie usuwaj</option>'+
				'<option value="+">Tak, usuń</option>'+
			'</select>';
		var button = [
			{
				text: 'Anuluj',
				click: function(){
					$(this).dialog('close');
				}
			},
			{
				text: 'OK',
				click: function(){
					var mode = $('#admopts-del-'+md5(channel)).val();
					var svsmode = $('#admopts-delsvs-'+md5(channel)).val();
					if(mode == '-' && svsmode == '-'){
						$$.alert('Wybierz jedną z opcji!');
						return;
					}
					if(mode != '-') ircCommand.mode(channel, mode +' '+nick);
					if(svsmode == '+') ircCommand.ChanServ('ACCESS', [channel, 'DEL', nick]);
					$(this).dialog('close');
				}
			}
		];
		$$.displayDialog('admin', channel, 'Zarządzanie '+he(channel), html, button);
	},
	'showChannelModes': function(channel) {
		var channame = channel.substring(1);
		var ch = md5(channame);
		
		var html = "<p>Zmień tryby kanału "+he(channel)+":</p>" +
			"<table><tr><th></th><th>Litera</th><th>Opis</th></tr>";
		//generate HTML table with all supported and settable chanmodes
		modes.changeableSingle.forEach(function(mode){
			if(modes['single'].indexOf(mode[0]) >= 0) html += '<tr><td><input type="checkbox" id="'+ch+'_mode_'+mode[0]+'"></td><td>'+mode[0]+'</td><td>'+mode[1]+'</td></tr>';
		}, this);
		modes.changeableArg.forEach(function(mode){
			if(modes['argAdd'].indexOf(mode[0]) >= 0 || modes['argBoth'].indexOf(mode[0]) >= 0) html += '<tr><td><input type="checkbox" id="'+ch+'_mode_'+mode[0]+'"></td><td>'+mode[0]+'</td><td>'+mode[1]+'</td><td><input type="text" id="'+ch+'_mode_'+mode[0]+'_text"></td></tr>';
		}, this);
		html += '</table>';

		var button = [ {
			text: 'Zatwierdź',
			click: function(){
				gateway.changeChannelModes(channel);
				$(this).dialog('close');
			}
		} ];

		$$.displayDialog('admin', channel, 'Zarządzanie '+he(channel), html, button);
			
		var chanModes = gateway.findChannel(channel).modes;
		if(!chanModes){
			return;
		}
		//uzupełnianie tabeli trybami już ustawionymi
		modes.changeableSingle.forEach(function(mode){
			if(chanModes[mode[0]]){
				$('#'+ch+'_mode_'+mode[0]).prop('checked', true);
			}
		}, this);
		modes.changeableArg.forEach(function(mode){
			if(chanModes[mode[0]]){
				$('#'+ch+'_mode_'+mode[0]).prop('checked', true);
				$('#'+ch+'_mode_'+mode[0]+'_text').val(chanModes[mode[0]]);
			}
		}, this);
	},
	'changeChannelModes': function(channel) {
		var modesw = '';
		var modeop = '';
		var modearg = '';
		var chanModes = gateway.findChannel(channel).modes;
		var channame = channel.substring(1);
		var ch = md5(channame);
		
		modes.changeableSingle.forEach(function(mode){
			mode = mode[0];
			var set = chanModes[mode];
			var checked = $('#'+ch+'_mode_'+mode).prop('checked');
			if(set != checked){
				if(checked){
					if(modeop != '+'){
						modeop = '+';
						modesw += '+';
					}
					modesw += mode;
				} else {
					if(modeop != '-'){
						modeop = '-';
						modesw += '-';
					}
					modesw += mode;
				}
			}
		}, this);
		
		modes.changeableArg.forEach(function(mode){
			mode = mode[0];
			var set = chanModes[mode];
			var checked = $('#'+ch+'_mode_'+mode).prop('checked');
			var text = $('#'+ch+'_mode_'+mode+'_text').val();
			if(set != checked || (set && set != text)){
				if(checked){
					if(modeop != '+'){
						modeop = '+';
						modesw += '+';
					}
					modesw += mode;
					modearg += text + ' ';
				} else {
					if(modeop != '-'){
						modeop = '-';
						modesw += '-';
					}
					modesw += mode;
					if(mode == 'k'){
						modearg += text + ' ';
					}
				}
			}
		}, this);
		
		ircCommand.mode(channel, modesw+' '+modearg);
		setTimeout(function(){ gateway.showChannelModes(channel); }, 2000);
	},
	'showInvitePrompt': function(channel) {
		var html = '<p>Nick: <input id="inviteNick" type="text"></p>';
		var button = [ {
			text: 'Anuluj',
			click: function(){
				$(this).dialog('close');
			}
		}, {
			text: 'Zaproś',
			click: function(){
				var nick = $('#inviteNick').val();
				if(!nick || nick == ''){
					$$.alert('Musisz podać nicka!');
					return;
				}
				ircCommand.channelInvite(channel, nick);
				$(this).dialog('close');
			}
		} ];
		$$.displayDialog('admin', 'invite-'+channel, 'Zaproś użytkownika na '+he(channel), html, button);
	},
	'knocking': function(channel, nick, reason) {
		var html = '<b>'+nick+'</b> prosi o dostęp na <b>'+he(channel)+'</b> ('+$$.colorize(reason)+')';
		var button = [ {
			text: 'Zaproś',
			click: function(){
				ircCommand.channelInvite(channel, nick);
				$(this).dialog('close');
			}
		} ];
		$$.displayDialog('knock', nick, 'Prośba o dostęp', html, button);
	},
	'showKick' : function(channel, nick) {
		var html = "<p>Wyrzuć użytkownika "+he(nick)+" z kanału "+he(channel)+". Możesz podać powód dla KICKa, który zostanie wyświetlony dla wszystkich użytkowników kanału.</p>" +
			"<input type='text' id='kickinput' maxlength='307' />";
		var button = [ {
			text: 'Anuluj',
			click: function(){
				$(this).dialog('close');
			}
		}, {
			text: 'Wyrzuć',
			click: function(){
				var reason = $('#kickinput').val();
				ircCommand.channelKick(channel, nick, reason);
				$(this).dialog('close');
			}
		} ];
		$$.displayDialog('admin', 'kick-'+channel, 'KICK', html, button);
	},
	/*'showBan' : function(channel, nick) {
		$(".status-text").text(" ");
		banData.clear();
		banData.nick = nick;
		banData.channel = channel;

		var nickListItem = gateway.findChannel(channel).nicklist.findNick(nick);
		var host = nickListItem.host;
		var ident = nickListItem.ident;
		var nline = '<td><input type="checkbox" onchange="gateway.banFormatView()" id="banNick" checked="checked"></td><td></td>';
		var html = '<h3>Ban</h3>' +
			"<p>Zablokuj dostęp dla "+he(nick)+" na kanale "+he(channel)+".</p>" +
			'<form action="javascript:void"><table>' +
				'<tr><td>' + nick + '</td><td>!</td>';
		if(ident.charAt(0) == '~'){
			html += '<td>~</td>';
			nline += '<td><input onchange="gateway.banFormatView()" type="checkbox" id="banNoIdent"></td>';
			ident = ident.substr(1);
			banData.noIdent = true;
		}
		banData.ident = ident;
		html += '<td>'+ident+'</td><td>@</td>'
		nline += '<td><input type="checkbox" onchange="gateway.banFormatView()" id="banIdentText" checked="checked"></td><td></td>';
		
		var i = 0;
		var cnt = 0;
		var hostElement = '';
		
		do {
			var c = host.charAt(i);
			switch(c){
				default: hostElement += c; break;
				case ':': case '.':
					html += '<td>'+hostElement+'</td><td>'+c+'</td>';
					nline += '<td><input type="checkbox" onchange="gateway.banFormatView()" id="banHostElement'+cnt+'"></td><td></td>';
					banData.hostElements.push(hostElement);
					banData.hostElementSeparators.push(c);
					hostElement = '';
					cnt++;
					break;
			}
			i++;
		} while(host.charAt(i));
		banData.hostElements.push(hostElement);
		html += '<td>'+hostElement+'</td>';
		nline += '<td><input type="checkbox" onchange="gateway.banFormatView()" id="banHostElement'+cnt+'" checked="checked"></td>';
		html += '</tr><tr>'+nline+'</tr></table></form>' +
			'<p>Postać bana: <span id="banFormat"></span></p>' + 
  //	  $(".status-text").append("<input type='text' class='kickinput' maxlenght='307' />");
			'<p class="statusbutton" onClick="gateway.banClick()">Banuj</p>';
		$(".status-text").html(html);
		if(cnt > 0){
			$('#banHostElement'+(cnt-1)).prop('checked', true);
		}
		$(".statuswindow").fadeIn(200);
		gateway.banFormatView();
	},
	'banClick': function() {
	},
	'banFormatView': function() {
		var banFormat = '';
		if($('#banNick').is(':checked')){
			banFormat += banData.nick;
		} else {
			banFormat += '*';
		}
		banFormat += '!';
		if(banData.noIdent){
			if($('#banNoIdent').is(':checked')){
				banFormat += '~';
			} else {
				banFormat += '*';
			}
		}
		if($('#banIdentText').is(':checked')){
			banFormat += banData.ident;
		} else {
			banFormat += '*';
		}
		banFormat += '@';
		var len = banData.hostElements.length;
		var hostElementAdded = false;
		for(var i=0;i<len;i++){
			if($('#banHostElement' + i).is(':checked')){
				if(!hostElementAdded){
					hostElementAdded = true;
					if(i > 0){
						banFormat += '*'+lastSeparator;
					}
				}
				banFormat += banData.hostElements[i];
				
			} else {
				if(hostElementAdded) {
					banFormat += '*';
				} else {
					var lastSeparator = banData.hostElementSeparators[i];
				}
			}
			if(hostElementAdded && i < len-1){
				banFormat += banData.hostElementSeparators[i];
			}
		}
		if(!hostElementAdded){
			banFormat += '*';
		}
		$('#banFormat').text(banFormat);
		return banFormat;
	},*/
	'getActive': function() {
		if(gateway.active == '--status') {
			return false;
		} else if(gateway.findChannel(gateway.active)) {
			return gateway.findChannel(gateway.active);
		} else if(gateway.findQuery(gateway.active)) {
			return gateway.findQuery(gateway.active);
		} else {
			return false;
		}
	},
	'active': '--status',
	'toggleNickOpt': function(nicklistid) {
		if($('#'+nicklistid+'-opt').is(':visible')) {
			if($('#'+nicklistid+'-opt-info').is(':visible')){
				 $('#'+nicklistid+'-opt-info').hide('blind', {
					direction: "vertical"
				}, 300);
				$('#'+nicklistid+'-opt').removeClass('activeInfo');
			 }
			$('#'+nicklistid+'-opt').hide('blind', {
				direction: "vertical"
			}, 300);
			$('#'+nicklistid).removeClass('activeNick');
		} else {
			$('#'+nicklistid+'-opt').show('blind', {
				direction: "vertical"
			}, 300);
			$('#'+nicklistid).addClass('activeNick');
		}
	},
	'toggleNickOptInfo': function(nicklistid) {
		if($('#'+nicklistid+'-opt-info').is(':visible')){
			 $('#'+nicklistid+'-opt-info').hide('blind', {
				direction: "vertical"
			}, 300);
			$('#'+nicklistid+'-opt').removeClass('activeInfo');
		} else {
			$('#'+nicklistid+'-opt-info').show('blind', {
				direction: "vertical"
			}, 300);
			$('#'+nicklistid+'-opt').addClass('activeInfo');
		}
	},
	'toggleNickOptAdmin': function(nicklistid) {
		if($('#'+nicklistid+'-opt-admin').is(':visible')){
			 $('#'+nicklistid+'-opt-admin').hide('blind', {
				direction: "vertical"
			}, 300);
			$('#'+nicklistid+'-opt').removeClass('activeAdmin');
		} else {
			$('#'+nicklistid+'-opt-admin').show('blind', {
				direction: "vertical"
			}, 300);
			$('#'+nicklistid+'-opt').addClass('activeAdmin');
		}
	},
	'toggleChannelOperOpts': function(channel) {
		var $element = $('#'+gateway.findChannel(channel).id+'-operActions ul');
		if($element.is(':visible')){
			$element.hide('blind', {
				direction: 'vertical'
			}, 300);
			$('#'+gateway.findChannel(channel).id+'-operActions .chstats-button').removeClass('channelAdminActive');
		} else {
			$element.show('blind', {
				direction: 'vertical'
			}, 300);
			$('#'+gateway.findChannel(channel).id+'-operActions .chstats-button').addClass('channelAdminActive');
		}
	},
	'toggleChannelOpts': function(channel) {
		var $element = $('#'+gateway.findChannel(channel).id+'-channelOptions ul');
		if($element.is(':visible')){
			$element.hide('blind', {
				direction: 'vertical'
			}, 300);
			$('#'+gateway.findChannel(channel).id+'-chstats .chstats-button').removeClass('channelAdminActive');
		} else {
			$element.show('blind', {
				direction: 'vertical'
			}, 300);
			$('#'+gateway.findChannel(channel).id+'-chstats .chstats-button').addClass('channelAdminActive');
		}
	},
	'toggleNickOpts': function() {
		var $element = $('#nickOptions')
		if($element.is(':visible')){
			$element.hide('blind', {
				direction: 'down'
			}, 300);
			$('#nickopts .nickoptsButton').removeClass('channelAdminActive');
		} else {
			$element.show('blind', {
				direction: 'down'
			}, 300);
			$('#nickopts .nickoptsButton').addClass('channelAdminActive');
		}
	},
	'showPermError': function(text) {
		var html = 'Brak uprawnień' +
			'<br>Nie masz wystarczających uprawnień aby wykonać żądaną akcję.<br>'+text;
		$$.displayDialog('error', 'error', 'Błąd', html);
	},
	'clickQuit': function() {
		var html = '<form id="quit-form" onsubmit="gateway.quit();" action="javascript:void(0);">'+
			'Wiadomość pożegnalna: <input type="text" id="quit-msg" value="Użytkownik rozłączył się" />';
			'</form>';
		var button = [ {
			text: 'Rozłącz',
			click: function(){
				$('#quit-form').submit();
				$(this).dialog('close');
			}
		}, {
			text: 'Anuluj',
			click: function(){
				$(this).dialog('close');
			}
		} ];
		$$.displayDialog('confirm', 'quit', 'Wyjście z IRC', html, button);
		$('#quit-msg').focus();
		$('#quit-msg').select();
	},
	'quit': function() {
		commands.quit.callback(['quit'], '/quit '+$('#quit-msg').val());
		$('.notifywindow').fadeOut(100);
	},
	'completion': {
		'string': '',
		'rawStr': '',
		'repeat': 0,
		'array': [],
		'lastPos': -1,
		'find': function(string, rawStr, comPos) {
			var complarr = [];
			var ccount = 0;
			//komendy
			//complarr[0] = string;
			//ccount++;
			if(string.length > 0 && string.indexOf('/') == 0 && comPos == 0) {
				for (i in commands) {
					if(i.indexOf(string.slice(1).toLowerCase()) == 0) {
						complarr[ccount] = '/'+i;
						ccount++;
					}
				}
			//else, bo jak sa komendy to nic innego nie trzeba uzup
			} else {
				if(string.indexOf('#') == 0) {
					for (var ichannel = 0; ichannel < gateway.channels.length; ichannel++) {
						if(gateway.channels[ichannel].name.toLowerCase().replace(/^[^a-z0-9]/ig).indexOf(string.toLowerCase().replace(/^[^a-z0-9]/ig)) == 0) {
							complarr[ccount] = gateway.channels[ichannel].name;
							ccount++;
						}
					}
				} else {
					if(gateway.findChannel(gateway.active)) {
						for (var inick=0; inick < gateway.findChannel(gateway.active).nicklist.list.length; inick++) {
							if(gateway.findChannel(gateway.active).nicklist.list[inick].nick.toLowerCase().replace(/^[^a-z0-9]/ig).indexOf(string.toLowerCase().replace(/^[^a-z0-9]/ig)) == 0) {
								complarr[ccount] = gateway.findChannel(gateway.active).nicklist.list[inick].nick;
								if(comPos == 0) {
									complarr[ccount] += ':';
								}
								ccount++;
							}
						}
					}
				}
			}
			return complarr;
		}
	},
	'doComplete': function() {
		if(gateway.completion.repeat == 0 || gateway.completion.array.length == 0) {
			var rawstr = $('#input').val().replace(/^\s+/g, '').replace(/\s+$/g, '');
			var str = $('#input').val().replace(/^\s+/g, '').replace(/\s+$/g, '').split(/\s+/);
			if(str && str.length > 0 && str[str.length-1].length > 0) {
				gateway.completion.array = gateway.completion.find(str[str.length-1], rawstr, str.length-1);
				if(gateway.completion.array.length > 0) {
					str[str.length-1] = gateway.completion.array[0] + " ";
					gateway.completion.repeat = 1;
					$('#input').val(str.join(" "));
					gateway.completion.lastPos = 0;
				}
				//gateway.statusWindow.appendMessage('%s - %s<br />', [ gateway.completion.lastPos, gateway.completion.array.toString() ]);
			}
		} else if(gateway.completion.array.length > 0) {
			var str = $('#input').val().replace(/^\s+/g, '').replace(/\s+$/g, '').split(/\s+/);
			if(gateway.completion.lastPos+1 < gateway.completion.array.length) {
				str[str.length-1] = gateway.completion.array[gateway.completion.lastPos+1] + " ";
				gateway.completion.lastPos++;
				$('#input').val(str.join(" "));
			} else {
				gateway.completion.lastPos = 0;
				str[str.length-1] = gateway.completion.array[0] + " ";
				$('#input').val(str.join(" "));
			}
		}
	},
	'parseChannelMode': function(args, chan, dispType /* 1 - joining a channel, 0 - changed when already on a channel */) {
		var plus = true;
		var nextarg = 1;
		var log = '';
		var mode = '';
		var modechar = '';
		var infoText = '';
		var dir = '';
		for (var i=0; i<args[0].length; i++) {
			var cchar = args[0][i];
			switch(cchar){
				case '+':
					log += "Change +\n";
					plus = true;
					if(dispType == 1){
						dir = '';
					} else {
						dir = 'ustawił ';
					}
					break;
				case '-':
					if(dispType == 1) continue;
					dir = 'zdjął ';
					log += "Change -\n";
					plus = false;
					break;
				default:
					var mtype = 'single';
					if(modes.argBoth.indexOf(cchar) >= 0){
						mtype = 'both';
					} else if(modes.argAdd.indexOf(cchar) >= 0){
						mtype = 'add';
					} else if(modes.list.indexOf(cchar) >= 0){
						mtype = 'list';
					} else if(modes.user.indexOf(cchar) >= 0){
						mtype = 'user';
					}
					
					switch(mtype){
						case 'both': case 'list':
							log += "Mode 'both' "+plus+' '+cchar+' '+args[nextarg]+"\n";
							infoText = infoText.apList(dir+getModeInfo(cchar, dispType)+' '+args[nextarg]);
							if(mtype != 'list'){
								if(plus){
									chan.modes[cchar] = args[nextarg];
								} else {
									chan.modes[cchar] = false;
								}
							}
							nextarg++;
							break;
						case 'add':
							log += "Mode 'add' "+plus+' '+cchar+' '+args[nextarg]+"\n";
							if(plus){
								chan.modes[cchar] = args[nextarg];
								infoText = infoText.apList(dir+getModeInfo(cchar+'-add', dispType)+' '+args[nextarg]);
								nextarg++;
							} else {
								infoText = infoText.apList(dir+getModeInfo(cchar+'-remove', dispType));
								chan.modes[cchar] = false;
							}
							break;
						case 'user':
							log += "Mode 'user' "+plus+' '+cchar+' '+args[nextarg]+"\n";
							if(chan.nicklist.findNick(args[nextarg])) {
								if(cchar in chStatusNames){
									mode = chStatusNames[cchar];
								} else {
									mode = cchar;
								}
								
								chan.nicklist.findNick(args[nextarg]).setMode(mode, plus);					
								infoText = infoText.apList((plus?'dał ':'odebrał ')+getModeInfo(cchar, dispType)+(plus?' dla':'')+' <span class="modevictim">'+args[nextarg]+'</span>');
							}
							nextarg++;
							break;
						default:
							log += "Mode 'normal' "+plus+' '+cchar+"\n";
							chan.modes[cchar] = plus;
							infoText = infoText.apList(dir+' '+getModeInfo(cchar, dispType));
							break;
					}
					break;
			}
		}
		//console.log(log); // MODE debugging
		return infoText;
	},
	'parseIsupport': function() {
		if('CHANMODES' in isupport){
			var modeTypes = isupport['CHANMODES'].split(',');
			if(modeTypes.length != 4){
				console.log('Error parsing CHANMODES isupport!');
				return;
			}
			modes.single = [];
			modes.argBoth = [];
			modes.argAdd = [];

			for(var i=0; i<4; i++){
				var modeChars = modeTypes[i];
				for(var j=0; j<modeChars.length; j++){
					switch(i){
						case 0: // list type (argBoth)
							modes.argBoth.push(modeChars.charAt(j));
							break;
						case 1: // add and remove with arguments (argBoth)
							modes.argBoth.push(modeChars.charAt(j));
							break;
						case 2: // add with arguments (argAdd)
							modes.argAdd.push(modeChars.charAt(j));
							break;
						case 3: // no arguments (single)
							modes.single.push(modeChars.charAt(j));
							break;
					}
				}
			}
		}
		if('PREFIX' in isupport){
			var expr = /^\(([^)]+)\)(.+)$/;
			var prefix = expr.exec(isupport['PREFIX']);
			if(!prefix || prefix[1].length != prefix[2].length){
				console.log('Error parsing PREFIX isupport!');
				return;
			}
			modes.user = [];
			modes.prefixes = [];
			
			for(var i=0; i<prefix[1].length; i++){
				modes.user.push(prefix[1].charAt(i));
				modes.prefixes[prefix[1].charAt(i)] = prefix[2].charAt(i);
				modes.reversePrefixes[prefix[2].charAt(i)] = prefix[1].charAt(i);
			}
		}
	},
	'storageHandler': function(evt) {
		if(!evt.newValue){
			return;
		}
		if(conn.waitForAlive && evt.key == 'checkAliveReply'){
			var nick = evt.newValue;
			conn.waitForAlive = false;
			
			var chan = guser.channels[0];
			var html = 'Masz już otwartą bramkę w innej karcie przeglądarki i jesteś połączony jako <strong>'+he(evt.newValue)+'</strong>! Nie można otworzyć drugiej bramki.';
			$('#not_connected_wrapper').fadeOut(400);
			
			try {
				localStorage.removeItem(evt.key);
				if(chan && chan != '#'){
					html += '<br>Przejdź do tamtej karty, aby wejść na <strong>'+chan+'</strong>.';
					localStorage.setItem('reqChannelJoin', guser.channels[0]);
				}
			} catch(e) {}


			$$.displayDialog('connect', '0', 'Już połączony!', html);
		}
		if(gateway.connectStatus == statusConnected){
			try {
				if(evt.key == 'checkAlive'){
					localStorage.removeItem(evt.key);
					localStorage.setItem('checkAliveReply', guser.nick);
				}
				if(evt.key == 'reqChannelJoin'){
					var chan = evt.newValue;
					localStorage.removeItem(evt.key);
					for(var i=0; i<gateway.channels.length; i++){
						if(gateway.channels[i].name.toLowerCase() == chan.toLowerCase()){
							return;
						}
					}
					var html = 'Inna karta chce dołączyć do kanału <strong>'+chan+'</strong>.';
					var button = [ {
						text: 'Anuluj',
						click: function(){
							$(this).dialog('close');
						}
					}, {
						text: 'Dołącz',
						click: function(){
							ircCommand.channelJoin(chan);
							$(this).dialog('close');
						}
					} ];
					$$.displayDialog('confirm', 'join', 'Potwierdź', html, button);
				}
			} catch(e) {}
		}
	},
	'quitQueue': [],
	'quitTimeout': false,
	'netJoinUsers': {},
	'netJoinQueue': [],
	'netJoinTimeout': false,
	'processNetsplit': function(){
		gateway.quitTimeout = false;
		if(gateway.quitQueue.length == 0) return;
		
		for(c in gateway.channels){
			var nickNames = '';
			var chan = gateway.channels[c];
			var nicklist = chan.nicklist;
			for(n in gateway.quitQueue){
				var nick = gateway.quitQueue[n].sender.nick;
				if(!gateway.netJoinUsers[chan.name]){
					gateway.netJoinUsers[chan.name] = {};
				}
				gateway.netJoinUsers[chan.name][nick] = (+new Date)/1000;
				if(nicklist.findNick(nick)){
					nicklist.removeNick(nick);
					if(nickNames != ''){
						nickNames += ', ';
					}
					nickNames += nick;
				}
			}
			if(nickNames != ''){
				chan.appendMessage(messagePatterns.netsplit, [$$.niceTime(), nickNames]);
			}
		}
		gateway.quitQueue = [];
	},
	'processNetjoin': function(){
		gateway.netJoinTimeout = false;
		if(gateway.netJoinQueue.length == 0) return;
		
		for(c in gateway.channels){
			var nickNames = '';
			var chan = gateway.channels[c];
			var nicklist = chan.nicklist;
			for(n in gateway.netJoinQueue){
				try {
					if(gateway.netJoinQueue[n].msg.text.toLowerCase() != chan.name.toLowerCase()){
						continue;
					}
				} catch(e) {
					console.error(e);
				}
				var nick = gateway.netJoinQueue[n].sender.nick;
				if(nickNames != ''){
					nickNames += ', ';
				}
				nickNames += nick;
			}
			if(nickNames != ''){
				chan.appendMessage(messagePatterns.netjoin, [$$.niceTime(), nickNames]);
			}
		}
		gateway.netJoinQueue = [];
	},
	'processQuit': function(msg){
		if(gateway.findQuery(msg.sender.nick)) {
			if (!$('#showPartQuit').is(':checked')) {
				gateway.findQuery(msg.sender.nick).appendMessage(messagePatterns.quit, [$$.niceTime(), he(msg.sender.nick), he(msg.sender.ident), he(msg.sender.host), $$.colorize(msg.text)]);
			}
		}

		if(msg.text.match(/^[^ :]+\.[^ :]+ [^ :]+\.[^ :]+$/)){
			gateway.quitQueue.push(msg);
			if(gateway.quitTimeout){
				clearTimeout(gateway.quitTimeout);
			}
			gateway.quitTimeout = setTimeout(gateway.processNetsplit, 700);
			return;
		}
		
		for(c in gateway.channels) {
			if(gateway.channels[c].nicklist.findNick(msg.sender.nick)) {
				gateway.channels[c].nicklist.removeNick(msg.sender.nick);
				if (!$('#showPartQuit').is(':checked')) {
					gateway.channels[c].appendMessage(messagePatterns.quit, [$$.niceTime(), he(msg.sender.nick), he(msg.sender.ident), he(msg.sender.host), $$.colorize(msg.text)]);
				}
			}
		}
	},
	'processJoin': function(msg){
		if(activeCaps.indexOf('extended-join') >= 0){
			var channame = msg.args[0];
		} else {
			var channame = msg.text;
		}
		var chan = gateway.findChannel(channame);
		var dlimit = (+new Date)/1000 - 300;
		if(!chan) return;
		var netjoin = false;
		if(gateway.netJoinUsers[msg.text] && gateway.netJoinUsers[msg.text][msg.sender.nick]){
			if(gateway.netJoinUsers[msg.text][msg.sender.nick] > dlimit){
				netjoin = true;
			}
			delete gateway.netJoinUsers[msg.text][msg.sender.nick];
		} 
		if(netjoin){
			gateway.netJoinQueue.push(msg);
			if(gateway.netJoinTimeout){
				clearTimeout(gateway.netJoinTimeout);
			}
			gateway.netJoinTimeout = setTimeout(gateway.processNetjoin, 700);
		} else if (!$('#showPartQuit').is(':checked')) {
			chan.appendMessage(messagePatterns.join, [$$.niceTime(), he(msg.sender.nick), he(msg.sender.ident), he(msg.sender.host), channame]);
		}
	},
	'findOrCreate': function(name, setActive){
		if(!name || name == ''){
			return null;
		}
		if(name.charAt(0) == '#'){ //kanał
			var tab = gateway.findChannel(name);
			if(!tab) {
				tab = new Channel(name);
				gateway.channels.push(tab);
			}
		} else { //query
			tab = gateway.findQuery(name);
			if(!tab) {
				tab = new Query(name);
				gateway.queries.push(tab);
			}
		}
		if(setActive){
			gateway.switchTab(name);
		}
		return tab;
	},
	'find': function(name){
		if(!name || name == ''){
			return false;
		}
		if(name.charAt(0) == '#'){ //kanał
			return gateway.findChannel(name);
		} else { //query
			return gateway.findQuery(name);
		}
		return false;
	},
	'smallListLoading': false,
	'smallListData': [],
	'toggleChanList': function() {
		if($('#chlist-body').is(':visible')){
			$('#chlist-body').css('display', '');

			$('#chlist').css('height', '').css('top', '');
			$('#nicklist').css('bottom', '');
			var nicklistBottom = $('#nicklist').css('bottom');
			$('#nicklist').css('bottom', '36%');
			$("#nicklist").animate({
				"bottom":	nicklistBottom
			}, 400);
			
			
			
			$('#chlist-button').text('⮙ lista kanałów ⮙');
		} else {
			$('#chlist-body').css('display', 'block');
			$('#chlist').css('height', 'initial').css('top', '64.5%');
		//	$('#nicklist').css('bottom', '31%');
			$("#nicklist").animate({
				"bottom":	"36%"
			}, 400);
			$('#chlist-button').text('⮛ schowaj listę ⮛');
			if(!$('#chlist-body > table').length){
				gateway.smallListLoading = true;
				ircCommand.listChannels('>9');
			}
		}
	},
	'toggleFormatting': function() {
		if($('#formatting').is(':visible')){
			$('#formatting').hide();
			$('#formatting-button').text('⮛ Wstaw kody formatowania ⮛');
		} else {
			$('#formatting').show();
			$('#formatting-button').text('⮙ Schowaj formatowanie ⮙');
		}
	},
	'refreshChanList': function() {
		gateway.smallListLoading = true;
		ircCommand.listChannels('>9');
		$('#chlist-body').html('Poczekaj, trwa ładowanie...');
	},
	'parseUmodes': function(modes) {
		var plus = false;
		for(var i=0; i<modes.length; i++){
			var c = modes.charAt(i);
			switch(c){
				case '+': plus = true; break;
				case '-': plus = false; break;
				case ' ': return;
				default: guser.setUmode(c, plus); break;
			}
		}
	},
	'enterPressed': function(){
		if(gateway.connectStatus == statusDisconnected || gateway.connectStatus == statusError){
			$$.alert('Nie możesz teraz wykonać komendy ani wysłać wiadomości, ponieważ nie masz połączenia z IRC.');
			return;
		}
		if(gateway.commandHistory.length == 0 || gateway.commandHistory[gateway.commandHistory.length-1] != $('#input').val()) {
			if(gateway.commandHistoryPos != -1 && gateway.commandHistoryPos == gateway.commandHistory.length-1) {
				gateway.commandHistory[gateway.commandHistoryPos] = $('#input').val();
			} else {
				gateway.commandHistory.push($('#input').val());
			}
		}
		gateway.parseUserInput($('#input').val());
		gateway.commandHistoryPos = -1;
	},
	'arrowPressed': function(dir){
		if(dir == 'up'){
			if(gateway.commandHistoryPos == gateway.commandHistory.length-1 && $('#input').val() != '') {
				gateway.commandHistory[gateway.commandHistoryPos] = $('#input').val();
			}
			if(gateway.commandHistoryPos == -1 && gateway.commandHistory.length > 0 && typeof(gateway.commandHistory[gateway.commandHistory.length-1]) == 'string') {
				gateway.commandHistoryPos = gateway.commandHistory.length-1;
				if($('#input').val() != '' && gateway.commandHistory[gateway.commandHistory.length-1] != $('#input').val()) {
					gateway.commandHistory.push($('#input').val());
				}
				$('#input').val(gateway.commandHistory[gateway.commandHistoryPos]);
			} else if(gateway.commandHistoryPos != -1 && gateway.commandHistoryPos != 0) {
				gateway.commandHistoryPos--;
				$('#input').val(gateway.commandHistory[gateway.commandHistoryPos]);
			}
		} else {
			if(gateway.commandHistoryPos == gateway.commandHistory.length-1 && $('#input').val() != '') {
				gateway.commandHistory[gateway.commandHistoryPos] = $('#input').val();
			}
			if(gateway.commandHistoryPos == -1 && $('#input').val() != '' && gateway.commandHistory.length > 0 && gateway.commandHistory[gateway.commandHistory.length-1] != $('#input').val()) {
				gateway.commandHistory.push($('#input').val());
				$('#input').val('');
			} else if (gateway.commandHistoryPos != -1) {
				if(typeof(gateway.commandHistory[gateway.commandHistoryPos+1]) == 'string') {
					gateway.commandHistoryPos++;
					$('#input').val(gateway.commandHistory[gateway.commandHistoryPos]);
				} else {
					gateway.commandHistoryPos = -1;
					$('#input').val('');
				}
			}
		}
	},
	'displayGlobalBanInfo': function(text){
		var html = '<p>Serwer nie zezwolił na to połączenie. Prawdopodobnie Twój adres IP został zbanowany.</p><p>Jeśli masz pewność, że nie zrobiłeś(aś) nic złego (sprawdź <a href="https://pirc.pl/teksty/zasady/" target="_blank">regulamin</a>), spróbuj następujących kroków:'+
			'<ul>'+
			'<li>Wyłącz usługi typu VPN, Proxy, TOR. Użytkownicy tych usług tak często dokonują nadużyć, że PIRC nie zezwala im na dostęp.</li>'+
			'<li>Zresetuj swój router. Być może Twój dostawca internetu przypadkowo przypisał Tobie adres, za pomocą którego ktoś inny zrobił kiedyś coś złego.</li>'+
			'<li>Skontaktuj się z administracją PIRC pod adresem e-mail abuse'+String.fromCharCode(64)+'pirc.pl</li>'+
			'</ul><br><p>Komunikat od serwera:<br>'+he(text)+'</p>';
		$$.closeDialog('connect', '1');
		$$.displayDialog('error', 'noaccess', 'Brak dostępu', html);
		gateway.connectStatus = statusBanned;
	},
	'inputPaste': function(e){ // TODO
		console.log(e);
		var items = (e.clipboardData || e.originalEvent.clipboardData).items;
		console.log(items);
	},
	'inputKeypress': function(e){
		if(activeCaps.indexOf('message-tags') < 0) return;
		if($('#input').val().length > 0 && $('#input').val().charAt(0) == '/') return; // typing a command
		if(!gateway.getActive()) return;
		if(gateway.lastKeypressWindow == gateway.getActive()){
			if($('#input').val() == ''){
/*				if(gateway.keypressSuppress){
					clearTimeout(gateway.keypressSuppress);
					gateway.keypressSuppress = false;
				}
				ircCommand.sendTags(gateway.getActive().name, '+draft/typing', 'done');*/
				return;
			} else {
				if(gateway.keypressSuppress) return;
			}
		}
		if(gateway.keypressSuppress){
			clearTimeout(gateway.keypressSuppress);
		}
		gateway.keypressSuppress = setTimeout(function(){
			gateway.keypressSuppress = false;
		}, 6500);
		gateway.lastKeypressWindow = gateway.getActive();
		ircCommand.sendTags(gateway.getActive().name, '+draft/typing', 'active');
	},
	'getMeta': function(nick, size){
		var avatar = gateway.getAvatarUrl(nick, size);
		if(avatar) {
			meta = '<img src="' + avatar + '" alt="'+nick+'" onerror="this.src=\'/styles/img/noavatar.png\';">';
		} else {
			if('display-name' in users.getUser(nick).metadata){
				var dispNick = users.getUser(nick).metadata['display-name'];
			} else {
				var dispNick = nick;
			}
			meta = '<span class="avatar letterAvatar" style="background-color:'+$$.nickColor(nick, true)+';"><span role="presentation">'+dispNick.charAt(0)+'</span></span>';
		}
		return meta;
	},
	'getAvatarUrl': function(nick, size){
		var user = users.getUser(nick);
		if(user.disableAvatar) return false;
		var avatar = false;
		if('avatar' in user.metadata){
			avatar = user.metadata['avatar'].replace('{size}', size.toString());
		}
		if(!avatar){
			var expr = /^~?[su]id([0-9]+)$/;
			var avmatch = expr.exec(user.ident);
			if(avmatch){
				var irccloudUrl = 'https://static.irccloud-cdn.com/avatar-redirect/s' + size.toString() + '/' + avmatch[1];
			//	if(ImageExists(irccloudUrl)){
					avatar = irccloudUrl;
			//	}
			}
		}
		return avatar;
	}
}

var insertBinding = function(list, item, handler){
	if(list[item]){
		list[item].push(handler);
	} else {
		list[item] = [ handler ];
	}
}

