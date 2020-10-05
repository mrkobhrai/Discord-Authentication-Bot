/*
 * Initialises discord.js library
 * Retrieves configuration for bot runtime
 */
const Discord = require('discord.js');
const nodemailer = require('nodemailer');
const server = require('./disc_config.json')

/*
 * Environment based imports
 */
const dotenv = require('dotenv');
dotenv.config();
const email = {
    "service": process.env.EMAILSERVICE,
    "user": process.env.EMAILUSER,
    "pass": process.env.EMAILPASS
}
const auth = {
    "token": process.env.DISCORDTOKEN
}
const serviceAccount = {
    "type": process.env.SERVICETYPE,
    "project_id": process.env.SERVICEPROJECTID,
    "private_key_id": process.env.SERVICEPRIVATEID,
    "private_key": process.env.SERVICEPRIVATEKEY.replace(/\\n/g, '\n'),
    "client_email": process.env.SERVICECLIENTEMAIL,
    "client_id": process.env.SERVICECLIENTID,
    "auth_uri": process.env.SERVICEAUTHURI,
    "token_uri": process.env.SERVICETOKENURI,
    "auth_provider_x509_cert_url": process.env.SERVICEAUTHPROVIDERCERT,
    "client_x509_cert_url": process.env.SERVICECLIENTCERT
  }

const database_uri = {
    "uri": process.env.DATABASEURI
}
/*
 * Initialises bot and Discord API keys
 */
const bot  = new Discord.Client();
const admin = require("firebase-admin");

/*
 * Part of the configuration variables
 * Guild is the Discord Server
 * Course roles stores all the roles related to courses and the 'Verified' role
 * Year roles store all roles related to years e.g. 1st, 2nd..
 * Committee role is kept seperate so has to be accessed directly
 * Meeting category refers to the Category of channels where meetings will be stored
 * Log channel is the channel where all of this bot logs are sent
 * Welcome channel is the channel where it is announced when a new user joins
 * Log book is the current logs stored in the session, these are not stored in the database
 * The email transporter is the variable which stores the open SMTP channel for sending emails
 */
var guild;

var course_roles = {};
var year_roles = {};

var COMMITTEE_ROLE;
var MEETING_CATEGORY;

var log_channel;
var welcome_channel;
var logbook = [];

var email_transporter;

/*
* Stored meeting room variables
* Loaded in locally as cache to reduce neccesity to access database
*/
var meeting_rooms = {};

/*
 * Initialises Firebase API keys
 */

const { user } = require('firebase-functions/lib/providers/auth');


/*
 *  Login DISCORD BOT with custom token
 */
bot.login(auth.token);

/*
 *  Initialise FIREBASE connection
 */
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: (database_uri.uri)
});

/*
 *  Initialise FIREBASE database reference pointers
 */
const database = admin.database();
const queue_ref = database.ref("/queue");
const verified_users = database.ref("/users");
const active_meetings = database.ref("active_meetings");

/*
 *  Configured variable to ensure configuration worked correctly
 */
var configured = false;

/*
 * ==================================================
 *              Discord Event Listeners
 * ==================================================
 */

/*
 * On Bot load up, attempt to configure it. If configuration is successful
 * notify admins on 'log' channnel
 */
bot.on('ready', () => {
    log("Attempting to run bot!");
    configure().then(function(){
        log("==================================");
        log("==================================");
        log("=============RESTART==============");
        log("==================================");
        log("==================================");
        // year_up();
        log("Bot running!");
        log("Due to bot being offline, will now verify all 'unverified' users to ensure complete authentication access");
        log("It will also then notify any users who are no longer verified, and tell them to verify their account");
        log("Commands:");
        print_commands();
        setTimeout(function(){notify_unverified_users()}, 2000);
    }).catch(log);
});

/*
 * Check for command '!notify_unverified' which notifies all unverified users by sending them their custom auth url
 * Should be done every time the Discord Bot is reloaded to deal with any users who joined while the bot was offline
 */
bot.on('message', message => {
    if(message.content === '!notify_unverified' && message.member != null && message.member.hasPermission("ADMINISTRATOR")){
        notify_unverified_users();
    }
});


/*
 * Check for command '!kick <user>' which kicks a user a deletes their data from the db
 */
bot.on('message', message => {
    if(message.content.startsWith('!kick') && message.member != null && message.member.hasPermission("ADMINISTRATOR")){
        message.mentions.users.forEach(function(user){
            var guildmember = get_member(user.id);
            if(guildmember != null){
                guildmember.kick();
                log("Kicked member:" + guildmember.nickname + " with discord id:" + guildmember.id);
            }else{
                log("No member found with id:" + user.id);
            }
        });
    }
});

/*
 * Check for command '!help' which lists all commands
 */
bot.on('message', message => {
    if(message.content === '!help' && message.member != null){
        if(message.member.hasPermission("ADMINISTRATOR")){
            print_commands();
        }else{
            var member = message.member;
            member.send("=====================COMMANDS====================");
            member.send("!help (Shows commands)");
            member.send("!meeting [<user>] (Creates a meeting of users, or will add the users to the current room)");
            member.send("=================================================");
        }
        message.delete();
    }
});

/*
 * Check for command '!logs' which prints all logs in the current bot session
 */
bot.on('message', message => {
    if(message.content === '!logs' && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        log_channel.send("-----BEGIN LOGBOOK-----");
        log_channel.send("LOGS:" + logbook.length);
        logbook.forEach((log) => log_channel.send("`"+log+"`"));
        log_channel.send("-----END   LOGBOOK-----");
    }
});

/*
 * Check for command '!committee' and a mention which gives the committee role to a member
 */
bot.on('message', message => {
    if(message.content.startsWith('!committee') && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        if(message.mentions.users.size > 1){
            log("Can only add one user at a time to committee for security reasons :)");
            message.delete();
            return;
        }
        message.mentions.users.forEach(function(member){
            var guildmember = get_member(member.id);
            if(guildmember == null){
                log("Trying to add member to committee but unknown member with userid: " + member.id);
            }else{
                guildmember.roles.add(COMMITTEE_ROLE).catch((error)=>log("Tried adding member:" + user.id + "to committee but failed with error:" + error));
                log("Successfully added member " + member.username+ " to committee group :) by user with username:" + message.author.username);
                
            }
        });
        message.delete();
    }
});

/*
 * Check for command '!clear_log_chat' which clears the chat
 */
bot.on('message', message => {
    if(message.content === '!clear_log_chat' && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        message.reply("Deleting logs!");
        log_channel.messages.cache.forEach((message)=> message.delete());
    }
});

/*
 * Check for command '!config' which prints the server configuration
 */
bot.on('message', message => {
    if(message.content === '!config' && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        print_server_config();
    }
});
/*
* When a member is added, log them joining and send them their custom auth url
*/
bot.on('guildMemberAdd', member => {
    member.send("Welcome to the DoCSoc Discord Server!");
    log("New Member Joined:" + member.displayName);
    if(configured){
        welcome_channel.send("Hello <@" + member.id + ">! I've sent you a link to verify your status as a DoCSoc Member!\nPlease check your DMs!");
    }
    send_user_auth_url(member);
});

/*
* Tracks voice channel state changes
* This is used to regulate meeting rooms
* When a meeting room is completely empty, it begins the countdown before the room is deleted
* If a room countdown has begun, then someone joins the voice chat, it resets the countdown
*/
bot.on('voiceStateUpdate', function(oldState, newState){
    //Check when voice channel is left (setTimeout()) function
    
    //Check for channel change 
    if(oldState.channel == newState.channel){
        return;
    }

    //If a voice channel is left
    if(oldState.channel != null){
        if(Object.keys(meeting_rooms).includes(oldState.channel.name)){

            var name = oldState.channel.name;
            if(oldState.channel.members.size == 0){
                var meeting_room = meeting_rooms[name];
                get_channel(meeting_room.chat).send("There is no one in the voice chat, this means the meeting will end in " + server.MEETING_TIMEOUT_TIME + " seconds");
                get_member(meeting_room["owner_id"]).send("Your meeting room "  + name + " will delete in " + server.MEETING_TIMEOUT_TIME + " seconds unless the voice chat becomes active in this time period. You have been emailed a copy of the meeting chat");
                meeting_rooms[name]["timeout"] = setTimeout(function(){
                    delete_room(oldState.channel.name);
                }, server.MEETING_TIMEOUT_TIME * 1000);
            }
        }
    }
    //End timer if voice chat is joined, (clearTimeout()) function
    if(newState.channel != null && Object.keys(meeting_rooms).includes(newState.channel.name)){
        //If channel name is in new state, reset timer
        var name = newState.channel.name;
        clearTimeout(meeting_rooms[name]["timeout"]);
    }
})

/*
* This command creates a user meeting with a set of mentioned users
* Meeting rooms can only be created by a verified user, but can include non-verified users
* At the moment, meeting rooms must expire before you can make another one
*/
 bot.on('message', async function(message){
     //Check the command begins with !meeting and is done by a verified member, and configuration is complete
    if(message.content.startsWith('!meeting') && message.member != null && message.member.roles.cache.find( r=> r.id === server.roles.Verified ) && configured){
       //Check if user has active room
       var has_room = false;
       var room = null; 
       for(var room_name in meeting_rooms){
           if(meeting_rooms[room_name]["owner_id"] == message.author.id){
               has_room = true;
               room = room_name;
           }
       }

       if(has_room){
        meeting_room = meeting_rooms[room];
        var role = await get_role(meeting_room.role);
        message.mentions.users.forEach((member)=>{
             if(!meeting_room.members.includes(member.id))
             {
                 get_member(member.id).roles.add(role);
                 member.send("You've been added to " + room + " room by the user " + get_member(message.author.id).nickname);
                 meeting_room.members.push(member.id);
             }
         });
         meeting_rooms[room] = {
             "voice": meeting_room.voice,
             "chat": meeting_room.chat,
             "members" : meeting_room.members,
             "owner_id" : meeting_room.owner_id,
             "owner_shortcode" : meeting_room.owner_shortcode,
             "role" : meeting_room.role,
             };
        active_meetings.child(room).set(meeting_rooms[room]);
        meeting_rooms[room]["timeout"] = meeting_room.timeout;
        message.delete();
        return;
    }
       
       //Get the message senders shortcode.
        var author_shortcode = (await get_shortcode(message.author.id))[0];
        //Discord member ids
        var member_ids = [];
        //Add the author to the member lists
        member_ids.push(message.author.id);
        var has_name = false;
        var meeting_room_name;
        var base_name = message.member.nickname + "s_room_";
        for(var i = 1; !has_name; i++){
            if(!Object.keys(meeting_rooms).includes(base_name + i) || meeting_rooms[base_name + i] == false){
                has_name = true;
                meeting_room_name = base_name + i;
                meeting_rooms[meeting_room_name] =  true;
            }
        }

        var role;
        var voice_channel;
        var text_channel;
        role = await guild.roles.create({
            data: {
                name : meeting_room_name
            }
        }).then((role)=>role).catch(log);

        //Create voice channel
        voice_channel = await guild.channels.create(meeting_room_name, { 
            type : 'voice', 
            parent : MEETING_CATEGORY,
            permissionOverwrites: [
                // {
                //     id: server.EVERYONE_ROLE_SAFE,
                //     deny: ['VIEW_CHANNEL']
                // },
                {
                    id: role.id,
                    allow: ['VIEW_CHANNEL']
                }
            ]
        }).then((voice_channel)=>voice_channel).catch(log);

        //Create text channel
        text_channel = await guild.channels.create(meeting_room_name, { 
            type : 'text', 
            parent : MEETING_CATEGORY,
            permissionOverwrites: [
                {
                    id: server.EVERYONE_ROLE_SAFE,
                    deny: ['VIEW_CHANNEL']
                },
                {
                    id: role.id,
                    allow: ['VIEW_CHANNEL']
                }
            ]
        }).then((text_channel)=>text_channel).catch(log);
        text_channel.send("Meeting Channel");
        text_channel.send("_A copy of this chat will be sent to each member once the meeting ends_");
        text_channel.send("_The meeting will end after "+server.MEETING_TIMEOUT_TIME+" seconds of inactivity in the voice channel_");
        get_member(message.author.id).roles.add(role);

        message.mentions.users.forEach((member)=>{
            if(!member_ids.includes(member.id))
            {
                get_member(member.id).roles.add(role);
                member.send("You've been added to " + meeting_room_name + " room by the user " + get_member(message.author.id).nickname);
                member_ids.push(member.id);
            }
        });

        //Create dictionary object
        var meeting_object = {
        "voice": voice_channel.id,
        "chat" : text_channel.id ,
        "members" : member_ids,
        "owner_id" : message.author.id,
        "owner_shortcode" : author_shortcode,
        "role" : role.id
        }
        //Log meeting creation
        log("Created meeting with attributes:\n" +  
        "voice: " + voice_channel.id + "\n" +
        "chat: " + text_channel.id  + "\n" +
        "members: " + member_ids  + "\n" +
        "owner_id: " + message.author.id  + "\n" + 
        "owner_shortcode: " + author_shortcode  + "\n" +
        "role: " + role.id);
        //Update database
        active_meetings.child(meeting_room_name).set(meeting_object);
        
        meeting_object["timeout"] = setTimeout(function(){
            delete_room(meeting_room_name);
        }, server.MEETING_TIMEOUT_TIME * 1000);

        //Update cache
        meeting_rooms[meeting_room_name] = meeting_object;
        
        message.author.send("================================================");
        message.author.send("Created a meeting for you with name " + meeting_room_name);
        message.author.send("This meeting room will self-destruct in the event of " + (server.MEETING_TIMEOUT_TIME) + " seconds of inactivity");
        message.author.send("================================================");
        message.delete();
    }
});

/*
 * ==================================================
 *                DATABASE LISTENERS
 * ==================================================
 */

/*
 * Database event listener. Interestingly, listener takes all backlog from when the bot was offline
 * Takes queued authentication and attempts to verify user members associated with each account
 */
queue_ref.on("child_added", async function(snapshot,prevChildKey){
    if(!configured){
        await configure()
    }
    on_queue(snapshot,prevChildKey)
});

function on_queue(snapshot, prevChildKey){
    if(!configured){
        log("Not configured, can't deal with queue!");
        return;
    }
    db_user = snapshot.val();
    var member = get_member(db_user.id);
    if(member == null){
        log("User not found through login with shortcode:" + db_user.name + ". Discord ID attempted:" + db_user.id);
        queue_ref.child(snapshot.key).remove();
    }else{
        var shortcode = db_user.shortcode;
        var course = db_user.course;
        var year = db_user.year;
        verified_users.child(shortcode).once('value', async function(fetched_snapshot){
            var alternate_shortcode = await get_shortcode(db_user.id).then(async function(alternate_shortcode){
                console.log(alternate_shortcode[0] || shortcode);
                if((alternate_shortcode[0] || shortcode) != shortcode){
                    member.send("IMPORTANT:You're already verified under "+alternate_shortcode[0]+"! Someone just tried to reverify this account! \n\nDid you send someone your authentication link or try and reuse it yourself! This account is already registered to a shortcode. If you wish to update any information e.g. course or year, please contact an admin");
                    log("Member already verified with discord id " + member.id + " and member with shortcode: " + shortcode + " attempted to reverify this account. This is not allowed!");
                    queue_ref.child(snapshot.key).remove();
                    return;
                }
                else if(fetched_snapshot.val() === null || fetched_snapshot.val().disc_id === db_user.id){
                    if(fetched_snapshot.val() !== null && fetched_snapshot.val().disc_id === db_user.id){
                        //Reset member roles
                        await member.roles.set([]);
                    }
                    member.setNickname(db_user.name).catch((error)=>log("Can't set the nickname:" + db_user.name + " for this user(id):" + member.id + "->" + error));
                    member.roles.add(course_roles["Verified"])
                    if(Object.keys(server.roles).includes(course)){
                        member.roles.add(course_roles[course]);
                    }else{
                        log("Unidentified course :" + course + " when trying to add member" + db_user.name);
                    }

                    if(Object.keys(server.years).includes(year)){
                        member.roles.add(year_roles[year]);
                    }else{
                        log("Unidentified year :" + year + " when trying to add member" + db_user.name);
                    }

                    log("DoCSoc Member : "+ db_user.name +" signed up successfully with username: " + member.user.username + " and id: " + member.user.id +" and course group: "+course+" and year: "+ year +"!");
                    var userid = member.toJSON().userID.toString();
                    verified_users.child(shortcode).set({"username": member.user.username, "name": db_user.name, "disc_id" : userid, "email": db_user.email, "course": course, "year": year});
                    member.send("Well done! You've been verified as a member!");
                    member.send("You are now free to explore the server and join in with DoCSoc Events!");
                    member.send("Use the '!help' command in any channel to get a list of available commands");
                }else{
                    log("DocSoc Member: " + db_user.name + " signed in successfully. \n However this shortcode is already associated with discord id: "+ fetched_snapshot.val().disc_id + "\n so can't be associated with discord id: " + snapshot.val().id);
                    member.send("This shortcode is already registered to a Discord User!");
                    member.send('If you believe this is an error, please contact an Admin');
                }
                queue_ref.child(snapshot.key).remove();
            })
        })
    }
}


/*
 * ==================================================
 *                  HELPER FUNCTIONS
 * ==================================================
 */

 
/*
 * Logs to both console and to discord log channel if it exists
 */
function log(log){
    console.log(log);
    logbook.push(new Date(Date.now()).toLocaleString() + ":" + log);
    if(log_channel != null){
        log_channel.send("`"+log+"`");
    }
}

/*
 * Gets a channel given an id 
 * Pre: configured
 */
function get_channel(id){
    return guild.channels.cache.get(id);
}

/*
 * Gets a role given an id 
 * Pre: configured
 */
async function get_role(role_id){
    var result = await guild.roles.fetch(role_id).then(role=>role);
    return result;
} 

/*
 * Gets a member given an id 
 * Pre: configured
 */
function get_member(id){
    return guild.member(id);
}

/*
 * Prints the server configuration
 */
function print_server_config(){
    log("Server Config:\n-> SERVER: " + guild.toString() + "\n-> LOG CHANNEL: " + log_channel.name + "\n-> Meeting Timeout Time(s):" + server.MEETING_TIMEOUT_TIME);    
}

/*
 * Prints the commands 
 */
function print_commands(){
    log("-----------COMMANDS-------------");
    log("!help (Shows commands)");
    log("!notify_unverified (Sends URL's to all unverified users)");
    log("!kick [<user>] (Kicks mentioned users)")
    log("!logs (View all logs!)")
    log("!clear_log_chat (Clear the log chat from this runtimes logs)")
    log("!config (Prints the Server config)");
    log("!committee <user> (Gives a single user committee role, user @ to mention them as the argument!)");
    log("!meeting [<user>] (Creates a meeting of users, gives a voice and text chat)");
}

/*
 * Load meeting_rooms in via the database
 * This function exists in case the bot restarts during a meeting  
 */
async function sync_meetings(){
    log("Beginning sync of active meeting rooms");
    var fetched_rooms = (await active_meetings.once('value'));
    if(fetched_rooms.exists()){
        fetched_rooms = fetched_rooms.val();
        log("Found room:" + fetched_rooms);
        for(var room_name in fetched_rooms){
            //Add rooms to fetched_rooms
            var room = fetched_rooms[room_name];
            
            var voice_channel = get_channel(room.voice);

            if(voice_channel == null){
                return;
            }

            meeting_rooms[room_name] = room;
            if(voice_channel.members.size == 0){
                meeting_rooms[room_name]["timeout"] = setTimeout(function(){
                    delete_room(room_name);
                }, server.MEETING_TIMEOUT_TIME * 1000);
                var owner = get_member(room.owner_id);
                owner.send("Your meeting room " + room_name + " will delete in " + server.MEETING_TIMEOUT_TIME + " seconds unless the voice chat becomes active in this time period");
            }   
        }
    }
}

/*
 * This function iterates through all unverified users and sends them their custom
 * authentication URL
 */
function notify_unverified_users(){
    var notifications = 0;
    if(configured){
        log("Beginning: Notifiying Unverified Users");
        guild.members.cache.forEach(guildMember => {
            if(!guildMember.roles.cache.find( role => role.id === server.roles.Verified)){
                send_user_auth_url(guildMember);
                notifications++;
            }
        });
        log(notifications + " users notified!");
        log("Ending: Notifiying Unverified Users");
    }else{
        log("Can't clear backlog, configuration not set!");
    }
}


/*
 * Given a member object, sends the member their custom auth url
 */
function send_user_auth_url(member){
    member.send("Just one last step to get into the IC DoCSoc server :)")
    member.send("To complete your sign-up and verify your Discord Account, please login using your Imperial login details below:");
    member.send("https://discord.docsoc.co.uk/"+ member.id);
    member.send("This link will only work for your account! There is no point sharing it with other users");
    log("Sent custom URL to user: " + member.displayName + " for verification");
}

/*
* Fetch user shortcode from userid
*/
async function get_shortcode(disc_id){
    var result = [];
    await verified_users.orderByChild("disc_id").equalTo(disc_id).once('value').then(
        function(super_snap){
            if(super_snap.exists()){
                //Accounting for issue that may be multiply shortcodes associated to discord id
                //Bot won't like it, but it'll work, functionality only enabled for first result
                result = Object.keys(super_snap.val());
            }
        }
    ).catch(function(error){
        log("Tried to fetch the shortcode of a user with discord id: " + disc_id);
        log("Failed with error:\n" + error);
    });
    return result;
}

/*
 * Configures basics e.g. guild, log channel, verified role by fetching id from disc_config.json
 * If configuration fails, the bot should stop running after logging error!
 */
async function configure(){
    try{
        guild = bot.guilds.cache.get(server.SERVER_ID);
        log_channel = get_channel(server.LOG_CHANNEL_ID);
        welcome_channel = get_channel(server.WELCOME_CHANNEL_ID);
        MEETING_CATEGORY = get_channel(server.MEETING_ROOM_CATEGORY);
        //Update meeting_rooms
        await sync_meetings();
        //Populate roles
        for(var role in server.roles){
            //Left as console log to reduce initialisation spam
            //Errors will be sent to server
            console.log("Fetching role: " + role);
            course_roles[role] = await get_role(server.roles[role]).then((role)=> role).catch((error)=>log("Role fetch error on role " + role + " with error" + error));
        }

        for(var role in server.years){
            //Left as console log to reduce initialisation spam
            //Errors will be sent to server
            console.log("Fetching year role: " + role);
            year_roles[role] = await get_role(server.years[role]).then((role)=> role).catch(log);
        }
        //Left as console log to reduce initialisation spam
        //Errors will be sent to server
        console.log("Fetching committee role");
        COMMITTEE_ROLE = await get_role(server.COMMITTEE_ROLE_SAFE).then((role)=>role).catch(log);

        //Create email transporter object
        email_transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, 
            auth: {
                user: email.user,
                pass: email.pass
            }
        });

    } catch(error){
        log("FATAL!!!");
        log("CONFIGURATION FAILED WITH ERROR:");
        log(error);
    } finally{
        configured = true;
        log("-----------BOT BEGINS-----------");
        log("Bot Configured successfully!");
        print_server_config();        
    }
}

/*
* Delete a meeting room, associated chats and roles given it's ID
* Then sends emails to all the members of the chat containing the meeting room chat history
*/
async function delete_room(meeting_room_name){
    if(meeting_rooms[meeting_room_name] == null){
        log("Attempted to delete meeting room with voice channel name" + meeting_room_name + " however it failed because that doesn't exist inside the cache");
        return;
    }

    var meeting_room = meeting_rooms[meeting_room_name];
    var voice_channel = get_channel(meeting_room["voice"]);
    var text_channel = get_channel(meeting_room["chat"]);
    var role = await get_role(meeting_room["role"]);

    //Delete role
    await role.delete().catch(log);
    //Fetch all messages and print to log
    email_body  = "<h1>" + meeting_room_name + " chat log - DoCSoc Discord</h1>";
    email_body += "<p><i> Please note this email does not necessarily represent the views of Imperial College London, the Department of Computing at Imperial College London or the Department of Computing Society or it's committee </i></p>";
    email_body += "<p>Meeting : " + voice_channel.createdAt  + " - " + new Date(Date.now()).toLocaleString() + "</p>";
    email_body += "<h3>Meeting Chat Log for " + meeting_room_name + "</h3>";
    email_body += "<div style=\"background-color : black; color: white; padding: 10px;\">"
    //Messages
    msgs = ""
    await text_channel.messages.fetch().then(messages => (messages.forEach(message=>{
        //Current message
        msg = "";
        var name;
        var author = get_member(message.author.id)
        if(author.nickname == null){
            name = "(Unverified)" + author.user.username;
        }else{
            name = author.nickname;
        }
        msg += name;
        msg += ":"; 
        msg += message.content;
        message.attachments.forEach(attachment=>{
            msg += "{Attachment URL}\n" + "<a href=\""+attachment.attachment+ "\">" +attachment.name + "</a>\n{/Attachment URL}\n";
        });
        //Added in reverse because message fetching is in reverse
        msgs = "<p>" + msg + "</p>" + msgs;
    })));
    email_body += msgs;

    var mailOptions = {
        from: email.user,
        to: "",
        subject: "Discord Meeting Room: " + meeting_room_name + " - " + voice_channel.createdAt,
        html: email_body
    };
    
    meeting_room.members.forEach((member_id)=>{
        get_shortcode(member_id).then((shortcodes)=>{
            if(shortcodes.length > 0){
                mailOptions.to = shortcodes[0] + "@ic.ac.uk";
                email_transporter.sendMail(mailOptions, function(error, info){
                    if (error) {
                      log("Email error");
                      log(error);
                    } else {
                      log('Email sent: ' + info.response);
                      log("Sent to: "+ mailOptions.to); 
                    }
                });
            }
        })
    })
    //Delete channels
    voice_channel.setName("DELETED");
    text_channel.setName("DELETED");
    await voice_channel.delete().catch(log);
    await text_channel.delete().catch(log);
    
    log("Deleted meeting room with name: " + meeting_room_name + " due to timeout");
    get_member(meeting_room["owner_id"]).send("MEETING ENDING:\nYour meeting room "  + meeting_room_name + " has expired due to " + server.MEETING_TIMEOUT_TIME + " seconds of inactivity in the voice chat");
    
    //Deleting
    active_meetings.child(meeting_room_name).remove();
    delete meeting_rooms[meeting_room_name];
}

/**
 * Augment Functions
 */
function year_up(){
    guild.members.cache.forEach((member)=>{
            member.send("New university year, new you :) For security reasons we ask that you reauthenticate your DoCSoc membership and update your details for the upcoming year!");
            member.send("You will be unable to use the server normally until you update your details");
            if(!member.user.bot){
                member.roles.set([]);
            }
    });
    verified_users.remove();       
}


enter_draw = database.ref('/fresher_game_night_draw');
bot.on('message', async function(message){
    if(message.channel.id==="762730212537401374" && message.content === '!enter' && message.member != null && message.member.roles.cache.find( r=> r.id === server.years["1st"]) && configured){
        var shortcode = await get_shortcode(message.member.id);
        if(shortcode.length <= 0){
            return;
        }
        log("Fresher "+ shortcode + " entered into the draw");
        enter_draw.child(shortcode[0]).set(true);
        message.member.send("You've been added into the random draw with a chance of winning a deliveroo voucher!");
        message.member.send("Please note you will only be added to the draw once :)");
    }
    message.delete();
})

bot.on('message', async function(message){
    // Freshers draw
    if(message.channel.id==="762730212537401374" && message.content === '!withdraw' && message.member != null && message.member.roles.cache.find( r=> r.id === server.years["1st"]) && configured){
        var shortcode = await get_shortcode(message.member.id);
        if(shortcode.length <= 0){
            return;
        }
        log("Fresher "+ shortcode + " withdrawn from the draw");
        enter_draw.child(shortcode[0]).set(false);
        message.member.send("You've been removed from the draw!")
        message.delete();

    }
})