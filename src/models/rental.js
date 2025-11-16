import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';

// Frontend-safe projection - excludes heavy/unnecessary fields
export const FRONTEND_PROJECTION = {
  // Include essential fields
  _id: 1,
  name: 1,
  summary: 1,
  property_type: 1,
  room_type: 1,
  accommodates: 1,
  bedrooms: 1,
  bathrooms: 1,
  beds: 1,
  price: 1,
  minimum_nights: 1,
  maximum_nights: 1,
  instant_bookable: 1,
  cancellation_policy: 1,
  number_of_reviews: 1,
  
  // Host info (minimal)
  'host.host_id': 1,
  'host.host_name': 1,
  'host.host_is_superhost': 1,
  'host.host_picture_url': 1,
  'host.host_response_rate': 1,
  'host.host_response_time': 1,
  
  // Address (essential location info)
  'address.street': 1,
  'address.neighbourhood': 1,
  'address.market': 1,
  'address.country': 1,
  'address.country_code': 1,
  
  // Images
  'images.picture_url': 1,
  'images.thumbnail_url': 1,
  
  // Essential amenities (first 10 most important)
  amenities: { $slice: 10 },
  
  // Reviews summary
  review_scores: 1,
  
  // Exclude heavy fields that aren't needed in FE:
  // - Full description (use summary instead)
  // - space, neighborhood_overview, notes, transit, access, interaction, house_rules
  // - Full host details (host_about, host_verifications, etc.)
  // - All review objects (too heavy)
  // - calendar_* fields
  // - availability_* detailed fields
};

// Detailed projection for single rental view
export const DETAILED_PROJECTION = {
  ...FRONTEND_PROJECTION,
  description: 1,
  space: 1,
  neighborhood_overview: 1,
  transit: 1,
  amenities: 1, // Full amenities list for details page
  'host.host_about': 1,
  'host.host_location': 1,
  'host.host_neighbourhood': 1,
  first_review: 1,
  last_review: 1,
};

// Search-optimized projection
export const SEARCH_PROJECTION = {
  _id: 1,
  name: 1,
  summary: 1,
  property_type: 1,
  room_type: 1,
  accommodates: 1,
  bedrooms: 1,
  bathrooms: 1,
  price: 1,
  instant_bookable: 1,
  number_of_reviews: 1,
  'host.host_is_superhost': 1,
  'address.neighbourhood': 1,
  'address.market': 1,
  'address.country': 1,
  'images.thumbnail_url': 1,
  'review_scores.review_scores_rating': 1,
};

export class RentalModel {
  constructor() {
    this.collection = database.getRentalsCollection();
  }

  // Validate ID - accept both ObjectId and other ID formats
  static isValidId(id) {
    return id && typeof id === 'string' && id.length > 0;
  }

  // Build search query with proper filtering
  static buildSearchQuery(params) {
    const query = {};
    
    // If specific IDs are provided, use them (for AI search results)
    if (params.ids) {
      const ids = Array.isArray(params.ids) ? params.ids : params.ids.split(',');
      // Handle both ObjectId and numeric IDs
      const objectIds = [];
      const numericIds = [];
      
      ids.forEach(id => {
        const trimmedId = id.toString().trim();
        if (ObjectId.isValid(trimmedId)) {
          objectIds.push(new ObjectId(trimmedId));
        } else {
          // Try as numeric ID
          const numericId = !isNaN(trimmedId) ? parseInt(trimmedId) : trimmedId;
          numericIds.push(numericId);
        }
      });
      
      if (objectIds.length > 0 && numericIds.length > 0) {
        query.$or = [
          { _id: { $in: objectIds } },
          { _id: { $in: numericIds } }
        ];
      } else if (objectIds.length > 0) {
        query._id = { $in: objectIds };
      } else if (numericIds.length > 0) {
        query._id = { $in: numericIds };
      }
      
      console.log('Built query for specific IDs:', query);
      return query; // Return early, ignore other filters when using specific IDs
    }
    
    // Text search
    if (params.text) {
      query.$text = { $search: params.text };
    }
    
    // Location search - optimized for common searches
    if (params.location) {
      query.$or = [
        { 'address.neighbourhood': { $regex: params.location, $options: 'i' } },
        { 'address.market': { $regex: params.location, $options: 'i' } },
        { 'address.country': { $regex: params.location, $options: 'i' } }
      ];
    }
    
    // Exact matches
    if (params.property_type) query.property_type = params.property_type;
    if (params.room_type) query.room_type = params.room_type;
    if (params.country) query['address.country'] = params.country;
    
    // Numeric filters
    if (params.min_price || params.max_price) {
      query.price = {};
      if (params.min_price) query.price.$gte = parseInt(params.min_price);
      if (params.max_price) query.price.$lte = parseInt(params.max_price);
    }
    
    if (params.min_bedrooms) query.bedrooms = { $gte: parseInt(params.min_bedrooms) };
    if (params.min_bathrooms) query.bathrooms = { $gte: parseInt(params.min_bathrooms) };
    if (params.min_accommodates) query.accommodates = { $gte: parseInt(params.min_accommodates) };
    
    // Boolean filters
    if (params.superhost_only === 'true') {
      query['host.host_is_superhost'] = true;
    }
    
    if (params.instant_bookable === 'true') {
      query.instant_bookable = true;
    }
    
    // Review score filter
    if (params.min_rating) {
      query['review_scores.review_scores_rating'] = { $gte: parseInt(params.min_rating) };
    }
    
    return query;
  }

  // Get rentals with pagination and projection
  async findMany(query = {}, options = {}) {
    const {
      limit = 20,
      skip = 0,
      sort = { price: 1 },
      projection = FRONTEND_PROJECTION
    } = options;

    const rentals = await this.collection
      .find(query, { projection })
      .sort(sort)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .toArray();

    const total = await this.collection.countDocuments(query);

    return {
      data: rentals,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        page: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasMore: parseInt(skip) + parseInt(limit) < total
      }
    };
  }

  // Get single rental by ID
  async findById(id, detailed = false) {
    if (!RentalModel.isValidId(id)) {
      throw new Error('Invalid rental ID format');
    }

    const projection = detailed ? DETAILED_PROJECTION : FRONTEND_PROJECTION;
    
    // Try to find by ObjectId first, then by the original _id field
    let query;
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    } else {
      // For non-ObjectId IDs, search by the original _id field (could be number or string)
      const numericId = !isNaN(id) ? parseInt(id) : id;
      query = { _id: numericId };
    }
    
    return await this.collection.findOne(query, { projection });
  }

  // Create new rental
  async create(rentalData) {
    const rental = {
      ...rentalData,
      created_at: new Date(),
      updated_at: new Date()
    };
    
    return await this.collection.insertOne(rental);
  }

  // Update rental
  async updateById(id, updateData) {
    if (!RentalModel.isValidId(id)) {
      throw new Error('Invalid rental ID format');
    }

    const update = {
      ...updateData,
      updated_at: new Date()
    };
    
    // Handle different ID formats
    let query;
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    } else {
      const numericId = !isNaN(id) ? parseInt(id) : id;
      query = { _id: numericId };
    }
    
    return await this.collection.updateOne(query, { $set: update });
  }

  // Delete rental
  async deleteById(id) {
    if (!RentalModel.isValidId(id)) {
      throw new Error('Invalid rental ID format');
    }
    
    // Handle different ID formats
    let query;
    if (ObjectId.isValid(id)) {
      query = { _id: new ObjectId(id) };
    } else {
      const numericId = !isNaN(id) ? parseInt(id) : id;
      query = { _id: numericId };
    }
    
    return await this.collection.deleteOne(query);
  }

  // Search with optimized projection
  async search(searchParams, options = {}) {
    const query = RentalModel.buildSearchQuery(searchParams);
    const searchOptions = {
      ...options,
      projection: SEARCH_PROJECTION
    };
    
    return await this.findMany(query, searchOptions);
  }

  // Get statistics
  async getStats() {
    const pipeline = [
      {
        $facet: {
          overall: [
            {
              $group: {
                _id: null,
                total_rentals: { $sum: 1 },
                avg_price: { $avg: '$price' },
                min_price: { $min: '$price' },
                max_price: { $max: '$price' },
                avg_rating: { $avg: '$review_scores.review_scores_rating' }
              }
            },
            {
              $project: {
                _id: 0,
                total_rentals: 1,
                avg_price: { $round: ['$avg_price', 2] },
                min_price: 1,
                max_price: 1,
                avg_rating: { $round: ['$avg_rating', 1] }
              }
            }
          ],
          byPropertyType: [
            {
              $group: {
                _id: '$property_type',
                count: { $sum: 1 },
                avg_price: { $avg: '$price' }
              }
            },
            {
              $project: {
                property_type: '$_id',
                count: 1,
                avg_price: { $round: ['$avg_price', 2] },
                _id: 0
              }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ],
          byCountry: [
            {
              $group: {
                _id: '$address.country',
                count: { $sum: 1 },
                avg_price: { $avg: '$price' }
              }
            },
            {
              $project: {
                country: '$_id',
                count: 1,
                avg_price: { $round: ['$avg_price', 2] },
                _id: 0
              }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ]
        }
      }
    ];

    const result = await this.collection.aggregate(pipeline).toArray();
    return result[0];
  }
}