const express = require('express');
const mongoose = require('mongoose');
const { connectDatabase } = require('./system/utils/database');
const { setupRoutes } = require('./system/routes');
const { WebSocketService } = require('./system/services/WebSocketService');
const { MonitoringService } = require('./system/services/MonitoringService');
const { BotService } = require('./system/services/BotService');
const SettingsService = require('./system/services/SettingsService');
const colors = require('colors');
const inquirer = require("inquirer");
const chalk = require("chalk");
const figlet = require("figlet");
const { Auth } = require('./system/services/auth');

class HexStatus {
    #PRODUCT_ID = '40';
    #currentVersion = '13.0.0';
    constructor() {
        this.botService = null;
        this.server = null;
        this.isShuttingDown = false;
    }

    async startServer() {

        try {
            // Display welcome banner first
            this.displayWelcome();

            // Continue with database connection and other initialization
            await this.connectWithRetry();
            console.log("[Database]".green, "Connected to MongoDB");

            Auth();

            const settings = await SettingsService.getSettings();
            this.botService = new BotService(settings);
            const client = await this.botService.initialize();

            const app = express();
            app.locals.settings = settings;
            
            // Enhanced error handling middleware
            app.use((err, req, res, next) => {
                console.error("[Error]".red, err.stack);
                res.status(500).json({ error: 'Internal Server Error' });
            });
            
            this.server = require('http').createServer(app);
            
            setupRoutes(app);
            WebSocketService.setupWebSocket(this.server);
            MonitoringService.initialize(client, settings);

            const PORT = settings.system.port || 3000;
            this.server.listen(PORT, async () => {
                console.log("[System]".green, "Hex Status:", 'Initialized');
                
            // Check version right after banner
            const https = require('https');
            await new Promise((resolve, reject) => {
                https.get(`https://hexarion.net/api/version/check?version=${encodeURIComponent(this.#currentVersion)}&product=${this.#PRODUCT_ID}`, (res) => {
                    let data = '';
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        try {
                            const parsedData = JSON.parse(data);
                            if (parsedData.same) {
                                console.log('[Updater]'.green, `Hex Status (v${this.#currentVersion}) is up to date!`);
                            } else {
                                console.log('[Updater]'.red, `Hex Status (v${this.#currentVersion}) is outdated. Update to v${parsedData.release?.version}.`);
                                process.exit(1);
                            }
                            resolve(parsedData);
                        } catch (error) {
                            console.log('[Updater]'.red, 'Hex Status update check failed:', error.message);
                            reject(error);
                        }
                    });
                }).on('error', (error) => {
                    console.log('[Updater]'.red, 'Version check failed:', error.message);
                    reject(error);
                });
            });
                console.log("[System]".yellow, "Server:", `Running on port ${PORT}`);
            });

            // Setup graceful shutdown
            this.setupGracefulShutdown();

        } catch (error) {
            console.log("[Error]".red, "Failed to start server:", error.message);
            process.exit(1);
        }
    }

    // Add as a separate class method
    displayWelcome() {
        console.clear();
        console.log("\n");
        console.log(
            chalk.red(
                figlet.textSync("Hex Status", {
                    font: "ANSI Shadow",
                    horizontalLayout: "full",
                })
            )
        );
        console.log("\n");
        console.log(chalk.red("━".repeat(70)));
        console.log(
            chalk.white.bold(
                "      Welcome to Hex Status - The Ultimate Status Page Solution   "
            )
        );
        console.log(chalk.red("━".repeat(70)), "\n");
    }
    async connectWithRetry(retries = 5) {
        for (let i = 0; i < retries; i++) {
            try {
                await mongoose.connect('mongodb://localhost:27017/Hex-Status', {
                    serverSelectionTimeoutMS: 15000,
                    connectTimeoutMS: 15000,
                    socketTimeoutMS: 45000
                });
                return;
            } catch (err) {
                if (i === retries - 1) throw err;
                console.log("[Database]".yellow, `Connection attempt ${i + 1} failed. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    setupGracefulShutdown() {
        const shutdown = async () => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            console.log("[System]".yellow, "Graceful shutdown initiated...");

            // Close HTTP server
            if (this.server) {
                await new Promise(resolve => this.server.close(resolve));
            }

            // Close WebSocket connections
            if (WebSocketService.wss) {
                WebSocketService.wss.close();
            }

            // Cleanup bot service
            if (this.botService) {
                await this.botService.cleanup();
            }

            // Close MongoDB connection
            await mongoose.connection.close();

            console.log("[System]".green, "Graceful shutdown completed");
            process.exit(0);
        };

        // Handle different shutdown signals
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
        process.on('uncaughtException', (error) => {
            console.error("[Error]".red, "Uncaught Exception:", error);
            shutdown();
        });
    }
}

// Add process-wide unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error("[Error]".red, 'Unhandled Rejection at:', promise, 'reason:', reason);
});


new HexStatus().startServer();
