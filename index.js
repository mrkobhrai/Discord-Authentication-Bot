/*
 * Initialises discord.js library
 * Retrieves configuration for bot runtime
 */
const Discord = require('discord.js');
const nodemailer = require('nodemailer');
const servers = require('./disc_config.json')

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
 * Log channel is the channel where all of this bot logs are sent
 * Welcome channel is the channel where it is announced when a new user joins
 * Log book is the current logs stored in the session, these are not stored in the database
 * The email transporter is the variable which stores the open SMTP channel for sending emails
 */

var guilds = {};

var email_transporter;
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
                guildmember.roles.add(committee_role).catch((error)=>log("Tried adding member:" + user.id + "to committee but failed with error:" + error));
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

async function on_queue(snapshot, prevChildKey){
    if(!configured){
        log("Not configured, can't deal with queue!");
        return;
    }
    db_user = snapshot.val();
    var member = await get_member_uncached(db_user.id);
    if(member == null){
        log("User not found through login with shortcode:" + db_user.name + ". Discord ID attempted:" + db_user.id);
        queue_ref.child(snapshot.key).remove();
    }else{
        var shortcode = db_user.shortcode;
        var course = db_user.course;
        var year = db_user.year;
        verified_users.child(shortcode).once('value', async function(fetched_snapshot){
            var alternate_shortcode = await get_shortcode(db_user.id).then(async function(alternate_shortcode){
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
    // logbook.push(new Date(Date.now()).toLocaleString() + ":" + log);
    // if(log_channel != null){
    //     log_channel.send("`"+log+"`");
    // }
}

/*
 * Gets a channel given an id 
 * Pre: configured
 */
function get_channel(id, guild){
    return guild.channels.cache.get(id);
}

/*
 * Gets a role given an id 
 * Pre: configured
 */
async function get_role(role_id, guild){
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
 * Gets a member given an id (not cached)
 */
async function get_member_uncached(id){
    return await guild.members.fetch(id);
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
 * This function iterates through all unverified users and sends them their custom
 * authentication URL
 */
async function notify_unverified_users(){
    var notifications = 0;
    if(configured){
        log("Beginning: Notifiying Unverified Users");
        guild.members.fetch().then((members)=>{
            members.forEach((guildMember)=>{
                if(!guildMember.roles.cache.find( role => role.id === server.roles.Verified)){
                    send_user_auth_url(guildMember);
                    notifications++;
                }
            });
            log(notifications + " users notified!");
            log("Ending: Notifiying Unverified Users");
        })
        
    }else{
        log("Can't send verification stuff, configuration not set!");
    }
}


/*
 * Given a member object, sends the member their custom auth url
 */
function send_user_auth_url(member){
    return;
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
        for(var server in servers){
            console.log("Beginning configure for server: " + server.SERVER_NAME);
            curr_guild = {};
            curr_guild.logbook = [];
            curr_guild.guild = bot.guilds.cache.get(server.SERVER_ID);
            curr_guild.log_channel = get_channel(server.LOG_CHANNEL_ID, curr_guild.guild);
            curr_guild.welcome_channel = get_channel(server.WELCOME_CHANNEL_ID, curr_guild.guild);

            //Populate roles
            curr_guild.course_roles = {};
            for(var role in server.roles){
                console.log("Fetching role: " + role);
                curr_guild.course_roles[role] = await get_role(server.roles[role], curr_guild.guild).then((role)=> role).catch((error)=>log("Role fetch error on role " + role + " with error" + error));
            }

            curr_guild.year_roles = {};
            for(var role in server.years){
                //Left as console log to reduce initialisation spam
                //Errors will be sent to server
                console.log("Fetching year role: " + role);
                curr_guild.year_roles[role] = await get_role(server.years[role], curr_guild.guild).then((role)=> role).catch(log);
            }
            //Left as console log to reduce initialisation spam
            //Errors will be sent to server
            console.log("Fetching committee role");
            curr_guild.committee_role = await get_role(server.COMMITTEE_ROLE_SAFE, curr_guild.guild).then((role)=>role).catch(log);
            curr_guild.queue_ref = database.ref(server.SERVER_NAME + "/queue");
            curr_guild.verified_users = database.ref(server.SERVER_NAME + "/users");
            guilds[server.SERVER_ID] = curr_guild;
        }
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