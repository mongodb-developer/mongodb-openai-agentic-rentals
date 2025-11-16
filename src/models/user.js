import { DatabaseManager } from '../config/database.js';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';

export class UserModel {
  static getCollection() {
    const db = DatabaseManager.getDatabase();
    return db.collection('users');
  }

  static async createUser(username, password) {
    try {
      const collection = this.getCollection();
      
      // Check if user already exists
      const existingUser = await collection.findOne({ username });
      if (existingUser) {
        return { success: false, error: 'Username already exists' };
      }

      // Hash password
      const saltRounds = 12;
      const password_hash = await bcrypt.hash(password, saltRounds);

      const user = {
        username,
        password_hash,
        created_at: new Date(),
        updated_at: new Date(),
        profile: {
          preferences: {},
          search_history: [],
          favorite_locations: [],
          saved_rentals: [],
          last_login: null
        },
        memory_stats: {
          total_conversations: 0,
          total_searches: 0,
          memory_entries: 0
        }
      };

      const result = await collection.insertOne(user);
      
      // Remove password hash from returned user
      const { password_hash: _, ...userWithoutPassword } = user;
      
      return { 
        success: true, 
        userId: result.insertedId,
        user: { ...userWithoutPassword, _id: result.insertedId }
      };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: error.message };
    }
  }

  static async authenticateUser(username, password) {
    try {
      const collection = this.getCollection();
      
      const user = await collection.findOne({ username });
      if (!user) {
        return { success: false, error: 'Invalid username or password' };
      }

      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        return { success: false, error: 'Invalid username or password' };
      }

      // Update last login
      await collection.updateOne(
        { _id: user._id },
        { 
          $set: { 
            'profile.last_login': new Date(),
            updated_at: new Date()
          }
        }
      );

      // Remove password hash from returned user
      const { password_hash: _, ...userWithoutPassword } = user;
      
      return { 
        success: true, 
        user: userWithoutPassword
      };
    } catch (error) {
      console.error('Error authenticating user:', error);
      return { success: false, error: error.message };
    }
  }

  static async getUserById(userId) {
    try {
      const collection = this.getCollection();
      const user = await collection.findOne({ _id: new ObjectId(userId) });
      
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Remove password hash from returned user
      const { password_hash: _, ...userWithoutPassword } = user;
      
      return { success: true, user: userWithoutPassword };
    } catch (error) {
      console.error('Error getting user by ID:', error);
      return { success: false, error: error.message };
    }
  }

  static async updateUserProfile(userId, profileUpdates) {
    try {
      const collection = this.getCollection();
      
      const updateFields = {};
      Object.keys(profileUpdates).forEach(key => {
        updateFields[`profile.${key}`] = profileUpdates[key];
      });
      updateFields.updated_at = new Date();

      const result = await collection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: updateFields }
      );

      return { success: true, modifiedCount: result.modifiedCount };
    } catch (error) {
      console.error('Error updating user profile:', error);
      return { success: false, error: error.message };
    }
  }

  static async incrementUserStats(userId, statType) {
    try {
      const collection = this.getCollection();
      
      const incrementField = {};
      incrementField[`memory_stats.${statType}`] = 1;

      await collection.updateOne(
        { _id: new ObjectId(userId) },
        { 
          $inc: incrementField,
          $set: { updated_at: new Date() }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error incrementing user stats:', error);
      return { success: false, error: error.message };
    }
  }

  static async addToSearchHistory(userId, searchQuery, filters = {}) {
    try {
      const collection = this.getCollection();
      
      const searchEntry = {
        query: searchQuery,
        filters,
        timestamp: new Date()
      };

      await collection.updateOne(
        { _id: new ObjectId(userId) },
        { 
          $push: { 
            'profile.search_history': {
              $each: [searchEntry],
              $slice: -50 // Keep only last 50 searches
            }
          },
          $set: { updated_at: new Date() }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error adding to search history:', error);
      return { success: false, error: error.message };
    }
  }

  static async saveRental(userId, rentalId, rentalData = null) {
    try {
      const collection = this.getCollection();
      
      const savedRental = {
        rental_id: rentalId,
        saved_at: new Date(),
        rental_data: rentalData // Store basic rental info for quick access
      };

      // Check if rental is already saved
      const user = await collection.findOne(
        { 
          _id: new ObjectId(userId),
          'profile.saved_rentals.rental_id': rentalId
        }
      );

      if (user) {
        return { success: false, error: 'Rental already saved' };
      }

      await collection.updateOne(
        { _id: new ObjectId(userId) },
        { 
          $push: { 'profile.saved_rentals': savedRental },
          $set: { updated_at: new Date() }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error saving rental:', error);
      return { success: false, error: error.message };
    }
  }

  static async unsaveRental(userId, rentalId) {
    try {
      const collection = this.getCollection();
      
      await collection.updateOne(
        { _id: new ObjectId(userId) },
        { 
          $pull: { 'profile.saved_rentals': { rental_id: rentalId } },
          $set: { updated_at: new Date() }
        }
      );

      return { success: true };
    } catch (error) {
      console.error('Error unsaving rental:', error);
      return { success: false, error: error.message };
    }
  }

  static async getSavedRentals(userId) {
    try {
      const collection = this.getCollection();
      
      const user = await collection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { 'profile.saved_rentals': 1 } }
      );

      if (!user) {
        return { success: false, error: 'User not found' };
      }

      return { 
        success: true, 
        savedRentals: user.profile?.saved_rentals || [] 
      };
    } catch (error) {
      console.error('Error getting saved rentals:', error);
      return { success: false, error: error.message };
    }
  }

  static async isRentalSaved(userId, rentalId) {
    try {
      const collection = this.getCollection();
      
      const user = await collection.findOne({
        _id: new ObjectId(userId),
        'profile.saved_rentals.rental_id': rentalId
      });

      return { success: true, isSaved: !!user };
    } catch (error) {
      console.error('Error checking if rental is saved:', error);
      return { success: false, error: error.message };
    }
  }

  static async getUserStats() {
    try {
      const collection = this.getCollection();
      
      const pipeline = [
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            totalConversations: { $sum: '$memory_stats.total_conversations' },
            totalSearches: { $sum: '$memory_stats.total_searches' },
            avgConversationsPerUser: { $avg: '$memory_stats.total_conversations' }
          }
        }
      ];

      const stats = await collection.aggregate(pipeline).toArray();
      
      return {
        success: true,
        stats: stats[0] || {
          totalUsers: 0,
          totalConversations: 0,
          totalSearches: 0,
          avgConversationsPerUser: 0
        }
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return { success: false, error: error.message };
    }
  }
}
