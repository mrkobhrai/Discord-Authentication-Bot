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
 * Log channel is the channel where all of this bot logs are sent
 * Welcome channel is the channel where it is announced when a new user joins
 * Log book is the current logs stored in the session, these are not stored in the database
 */
var guild;
var log_channel;
var welcome_channel;
var logbook = [];

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

/*
 *  Configured variable to ensure configuration worked correctly
 */
var configured = false;
const verified_role = null;
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
 * Check for command '!help' which lists all commands
 */
bot.on('message', message => {
    if(message.content === '!help' && message.member != null){
        if(message.member.hasPermission("ADMINISTRATOR")){
            print_commands();
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
        verified_users.child(shortcode).once('value', async function(fetched_snapshot){
            await get_shortcode(db_user.id).then(async function(alternate_shortcode){
                if((alternate_shortcode[0] || shortcode) != shortcode){
                    member.send("IMPORTANT:You're already verified under "+alternate_shortcode[0]+"! Someone just tried to reverify this account! \n\nDid you send someone your authentication link or try and reuse it yourself! This account is already registered to a shortcode.");
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

                    log("DoCSoc Member : "+ db_user.name +" signed up successfully with username: " + member.user.username + " and id: " + member.user.id +" and course group: "+course+" and year: "+ year +"!");
                    var userid = member.toJSON().userID.toString();
                    verified_users.child(shortcode).set({"username": member.user.username, "name": db_user.name, "disc_id" : userid});
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
        verified_role = await get_role(server.roles[role]).then((role)=> role).catch((error)=>log("Role fetch error on role " + role + " with error" + error));
        
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
